const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');
const { globToRegExp } = require('./glob');
const { VITEST_CONFIG_FILES, isVitestConfig, fromVitestConfig } = require('./vitest-config');

const DEFAULTS = {
  roots: ['.'],
  include: ['**/*.{test,spec}.?(c|m)[jt]s?(x)', '**/__tests__/**/*.?(c|m)[jt]s?(x)'],
  exclude: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/coverage/**'],
  // Regular expressions (Jest's testPathIgnorePatterns) matched against the path of every test file.
  excludePatterns: [],
  testTimeout: 5000,
  hookTimeout: undefined,
  setupFiles: [],
  // The order of a suite's afterEach and afterAll hooks: 'stack' (last registered first, as vitest) or 'list'
  // (declaration order, as Jest).
  hookOrder: 'stack',
  // Assertions a test does not await (expect(promise).resolves.toBe(x) without await): 'wait' for them, within the
  // test's timeout, as vitest does; 'settled' only counts those that fail straight away, as Jest drops them.
  unawaitedAssertions: 'wait',
  // Project modules are loaded fresh for every test file; node_modules stay loaded.
  isolate: true,
  // Packages loaded fresh for every test file too: those that keep state of their own at module level,
  // as MSW does with its interceptors, which a file would otherwise inherit from the one before.
  isolateDependencies: [],
  // threads: worker threads; inline: everything in the main thread.
  pool: 'threads',
  // A worker whose file failed is replaced, so state the failure left broken does not fail the files after it.
  replaceFailedWorkers: true,
  // Megabytes of heap after which a worker is replaced by a fresh one (0: never).
  workerMemoryLimit: 1024,
  maxWorkers: undefined,
  // true drops the console output of tests; 'passed-only' (as in vitest) keeps that of failing tests.
  silent: false,
  retry: 0,
  maxConcurrency: 5,
  allowOnly: true,
  passWithNoTests: false,
  bail: 0,
  reporter: 'default',
  clearMocks: false,
  resetMocks: false,
  restoreMocks: false,
  // V8 coverage of the project files the tests load.
  coverage: false,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
  // Jest's collectCoverageFrom: globs of the files to report, "!" excluding.
  collectCoverageFrom: undefined,
  coverageThreshold: undefined,
  // Files whose tests do not depend on each other, which can run in parts on several workers: true or globs.
  splitFiles: false,
  // 'node', 'happy-dom' or 'jsdom'; the last two come from the project, not from vyntra.
  environment: 'node',
  // The URL the document reports, which a component may read for its origin.
  environmentUrl: undefined,
  // Options for the document, in vitest's shape: { happyDOM: { settings }, jsdom: { ... } }.
  environmentOptions: undefined,
  // Set false to load files as they are, even when they need JSX compiled away.
  transform: undefined,
  // V8's on-disk code cache for the modules loaded (off: see cli/index.js).
  compileCache: false,
  // Vite plugins whose transform hooks rewrite the project's source (synchronous hooks only).
  plugins: [],
  // Jest's moduleNameMapper: { '<regex>': '<rootDir>/path/$1' }, for the aliases a bundler would resolve.
  moduleNameMapper: undefined,
  // The extensions tried for an import that names no file, in order, as a bundler does.
  moduleFileExtensions: ['js', 'mjs', 'cjs', 'ts', 'mts', 'cts', 'json', 'node'],
};

const CONFIG_FILES = ['vyntra.config.js', 'vyntra.config.cjs', 'vyntra.config.mjs'];
const JEST_FILES = ['jest.config.js', 'jest.config.cjs', 'jest.config.mjs', 'jest.config.json'];

const VITEST_CONFIG_STUB = pathToFileURL(path.join(__dirname, 'vitest-config-stub.mjs')).href;

// A vitest config imports defineConfig from 'vitest/config', which loads all of Vite: while the config loads, it gets
// vyntra's stand-in, which also lets it load where vitest is no longer installed.
const USES_PATHS = /\b__(?:dirname|filename)\b/;
const DECLARES_PATHS = /\b(?:const|let|var|function)\s+__(?:dirname|filename)\b/;
const ESM_SYNTAX = /^\s*(?:import|export)[\s{*]/m;

// The "type" of the nearest package.json, per directory (null when it has none).
const packageTypes = new Map();

function nearestType(dir) {
  if (!packageTypes.has(dir)) {
    let type;
    try {
      ({ type } = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')));
      type ??= null;
    } catch {
      const parent = path.dirname(dir);
      type = parent === dir ? null : nearestType(parent);
    }
    packageTypes.set(dir, type);
  }
  return packageTypes.get(dir);
}

// A module of the project the config loads, as Vite runs it: an ES module when it says it is one or is written as
// one (in a package with no "type", where Node would parse it as CommonJS first and warn about it,
// MODULE_TYPELESS_PACKAGE_JSON), with the __dirname and __filename Vite's bundling gives a config (Strapi's write
// `root: __dirname`). Anything else is left to Node.
// What the next load hook gives, or the file read here where it gives a CommonJS module without its source: Yarn's
// Plug'n'Play loader does, which hooks registered with module.registerHooks must not (see loadOrRead in loader.js).
function loadNext(url, context, nextLoad) {
  try {
    return nextLoad(url, context);
  } catch (error) {
    if (error?.code !== 'ERR_INVALID_RETURN_PROPERTY_VALUE' || !url.startsWith('file:')) {
      throw error;
    }
    const file = fileURLToPath(url);
    const format = path.extname(file) === '.json' ? 'json' : 'commonjs';
    return { format, source: fs.readFileSync(file, 'utf8'), shortCircuit: true };
  }
}

function loadConfigModule(url, context, nextLoad) {
  if (!url.startsWith('file:') || url.includes('/node_modules/')) {
    return loadNext(url, context, nextLoad);
  }
  const file = fileURLToPath(url);
  const ext = path.extname(file);
  const typescript = /^\.[cm]?ts$/.test(ext);
  const declared = { '.mjs': 'module', '.mts': 'module', '.cjs': 'commonjs', '.cts': 'commonjs' }[ext];
  if (declared === 'commonjs' || !/^\.[cm]?[jt]s$/.test(ext)) {
    return loadNext(url, context, nextLoad);
  }
  const type = declared ?? nearestType(path.dirname(file));
  if (type === 'commonjs') {
    return loadNext(url, context, nextLoad);
  }
  const source = fs.readFileSync(file, 'utf8');
  if (type !== 'module' && !ESM_SYNTAX.test(source)) {
    return loadNext(url, context, nextLoad);
  }
  const paths =
    USES_PATHS.test(source) && !DECLARES_PATHS.test(source)
      ? 'const __dirname = import.meta.dirname, __filename = import.meta.filename;'
      : '';
  return { format: typescript ? 'module-typescript' : 'module', source: `${paths}${source}`, shortCircuit: true };
}

async function importWithStubs(file) {
  const hooks = Module.registerHooks?.({
    resolve: (specifier, context, nextResolve) =>
      specifier === 'vitest/config' ? { url: VITEST_CONFIG_STUB, shortCircuit: true } : nextResolve(specifier, context),
    load: loadConfigModule,
  });
  try {
    return await import(pathToFileURL(file).href);
  } finally {
    hooks?.deregister();
  }
}

async function importConfig(file) {
  if (file.endsWith('.json')) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  // Imported whatever its kind: a CommonJS config comes as the default export, and TypeScript is stripped by Node.
  const loaded = await importWithStubs(file);
  const config = loaded?.default ?? loaded;
  // A config written as a function, as defineConfig allows, is called with what vitest passes it.
  return typeof config === 'function' ? config({ command: 'serve', mode: 'test', isSsrBuild: false }) : config;
}

// A config with a `test` section is a vitest (or Vite) config, whatever file it comes from; a jest*.config.* file
// given with --config (jest.config.front.js) is a Jest config.
async function importAnyConfig(file, rootDir) {
  const config = await importConfig(file);
  if (isVitestConfig(config)) {
    return fromVitestConfig(config, rootDir);
  }
  // eslint-disable-next-line no-use-before-define -- the Jest options are read further down
  return /^jest[.-]/.test(path.basename(file)) ? fromJestConfig(config, rootDir) : config;
}

function readPackageJson(rootDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  } catch {
    return {};
  }
}

const resolveRootDir = (value, rootDir) => (typeof value === 'string' ? value.replaceAll('<rootDir>', rootDir) : value);

// The file a Jest `preset` names: a path (to a file, or a directory with jest-preset.json/.js), or a package's own
// jest-preset, both from the root.
function presetFile(preset, rootDir) {
  const require = Module.createRequire(path.join(rootDir, 'package.json'));
  if (preset.startsWith('.') || path.isAbsolute(preset)) {
    const target = path.resolve(rootDir, preset);
    const inside = ['jest-preset.json', 'jest-preset.js', 'jest-preset.cjs']
      .map((name) => path.join(target, name))
      .find((file) => fs.existsSync(file));
    return inside ?? target;
  }
  return require.resolve(`${preset}/jest-preset`);
}

// A Jest config with its preset under it, as Jest merges them: the config wins, but its setup files come after the
// preset's, and its moduleNameMapper, transform and globals are added to the preset's (its own first).
function withJestPreset(jest, rootDir) {
  if (!jest.preset) {
    return jest;
  }
  // eslint-disable-next-line global-require -- the preset the config names
  const preset = withJestPreset(require(presetFile(jest.preset, rootDir)), rootDir);
  const merged = { ...preset, ...jest };
  ['setupFiles', 'setupFilesAfterEnv'].forEach((key) => {
    merged[key] = [...(preset[key] ?? []), ...(jest[key] ?? [])];
  });
  ['moduleNameMapper', 'transform', 'globals'].forEach((key) => {
    if (preset[key] || jest[key]) {
      merged[key] = {
        ...jest[key],
        ...Object.fromEntries(Object.entries(preset[key] ?? {}).filter(([k]) => !jest[key]?.[k])),
      };
    }
  });
  delete merged.preset;
  // Jest settles the root before the preset: a preset's rootDir does not move it.
  merged.rootDir = jest.rootDir;
  return merged;
}

// The options of a Jest config vyntra understands, so a Jest project runs without a vyntra config.
function fromJestConfig(original, rootDir) {
  const jest = withJestPreset(original, rootDir);
  const config = {};
  const copy = [
    'testTimeout',
    'clearMocks',
    'resetMocks',
    'restoreMocks',
    'maxWorkers',
    'bail',
    'maxConcurrency',
    'coverageDirectory',
    'coverageReporters',
    'coverageThreshold',
    'collectCoverageFrom',
    'moduleFileExtensions',
    'testEnvironment',
  ];
  copy
    .filter((key) => jest[key] !== undefined)
    .forEach((key) => {
      config[key] = jest[key];
    });
  config.hookOrder = 'list';
  config.unawaitedAssertions = 'settled';
  if (jest.collectCoverage) {
    config.coverage = true;
  }
  if (jest.testEnvironment) {
    config.environment = { jsdom: 'jsdom', 'happy-dom': 'happy-dom', node: 'node' }[jest.testEnvironment] ?? 'node';
    delete config.testEnvironment;
  }
  if (jest.moduleNameMapper) {
    config.moduleNameMapper = Object.fromEntries(
      Object.entries(jest.moduleNameMapper).map(([pattern, target]) => [
        pattern,
        Array.isArray(target) ? target.map((one) => resolveRootDir(one, rootDir)) : resolveRootDir(target, rootDir),
      ])
    );
  }
  const setupFiles = [...(jest.setupFiles ?? []), ...(jest.setupFilesAfterEnv ?? [])];
  if (setupFiles.length > 0) {
    config.setupFiles = setupFiles.map((file) => resolveRootDir(file, rootDir));
  }
  if (jest.testMatch) {
    // Jest matches them against absolute paths: "<rootDir>/x" is x from the root, which vyntra's globs are relative
    // to; the others ("**/__tests__/**/*.js") match anywhere, as they are.
    config.include = jest.testMatch.map((glob) => glob.replace(/^<rootDir>\//, '').replace(/^\.\//, ''));
  }
  // The project's transformers, which the files they match are compiled with (see jest-transform.js).
  if (jest.transform) {
    config.jestTransform = jest.transform;
  }
  if (jest.transformIgnorePatterns) {
    config.transformIgnorePatterns = jest.transformIgnorePatterns;
  }
  // Jest does not see the files under modulePathIgnorePatterns at all, so none of their tests run either. These are
  // regular expressions, matched against paths with "/": <rootDir> goes in as one ("C:\work" would read "\w").
  const ignored = [...(jest.testPathIgnorePatterns ?? []), ...(jest.modulePathIgnorePatterns ?? [])];
  if (ignored.length > 0) {
    const rootPattern = rootDir
      .split(path.sep)
      .join('/')
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    config.excludePatterns = ignored.map((pattern) => pattern.replaceAll('<rootDir>', rootPattern));
  }
  if (jest.roots) {
    config.roots = jest.roots.map((root) => resolveRootDir(root, rootDir));
  }
  return config;
}

// The vyntra config file in use, if there is one (not a package.json or Jest config).
function configFileOf(rootDir, explicit) {
  if (explicit) {
    return path.resolve(rootDir, explicit);
  }
  return CONFIG_FILES.map((name) => path.join(rootDir, name)).find((file) => fs.existsSync(file)) ?? null;
}

// The vitest config of the project: a vitest.config, or a vite.config with a `test` section. Returns
// { file, config } or null.
async function findVitestConfig(rootDir) {
  const files = VITEST_CONFIG_FILES.map((name) => path.join(rootDir, name)).filter((file) => fs.existsSync(file));
  for (let i = 0; i < files.length; i += 1) {
    // eslint-disable-next-line no-await-in-loop -- the first one that is a vitest config wins
    const config = await importConfig(files[i]);
    if (isVitestConfig(config)) {
      return { file: files[i], config: fromVitestConfig(config, rootDir) };
    }
  }
  return null;
}

async function findConfig(rootDir, explicit) {
  const own = configFileOf(rootDir, explicit);
  if (own) {
    return importAnyConfig(own, rootDir);
  }
  const pkg = readPackageJson(rootDir);
  if (pkg.vyntra) {
    return pkg.vyntra;
  }
  const vitest = await findVitestConfig(rootDir);
  if (vitest) {
    return { ...vitest.config, configFile: vitest.file };
  }
  const jestFile = JEST_FILES.map((name) => path.join(rootDir, name)).find((file) => fs.existsSync(file));
  if (jestFile) {
    return fromJestConfig(await importConfig(jestFile), rootDir);
  }
  return pkg.jest ? fromJestConfig(pkg.jest, rootDir) : {};
}

// collectCoverageFrom as a function of a file: included by one of the globs, and excluded by none of the "!" ones.
function coverageFilter(globs, rootDir) {
  if (!globs?.length) {
    return undefined;
  }
  const regexes = (list) => list.map((glob) => globToRegExp(glob.replace(/^!/, '').replace(/^\.\//, '')));
  const include = regexes(globs.filter((glob) => !glob.startsWith('!')));
  const exclude = regexes(globs.filter((glob) => glob.startsWith('!')));
  return (file) => {
    const relative = path.relative(rootDir, file).split(path.sep).join('/');
    return (
      (include.length === 0 || include.some((re) => re.test(relative))) && !exclude.some((re) => re.test(relative))
    );
  };
}

// A setup file is a path, or a package as vitest also takes them (setupFiles: ['reflect-metadata']).
function resolveSetupFile(file, rootDir) {
  const local = path.resolve(rootDir, file);
  if (file.startsWith('.') || path.isAbsolute(file) || fs.existsSync(local)) {
    return local;
  }
  try {
    return Module.createRequire(path.join(rootDir, 'package.json')).resolve(file);
  } catch {
    return local;
  }
}

async function loadConfig(cliOptions) {
  const rootDir = path.resolve(cliOptions.rootDir ?? process.cwd());
  const fileConfig = await findConfig(rootDir, cliOptions.config);
  const config = {
    ...DEFAULTS,
    ...fileConfig,
    ...cliOptions,
    rootDir,
    configFile: configFileOf(rootDir, cliOptions.config) ?? fileConfig.configFile ?? null,
  };
  config.setupFiles = config.setupFiles.map((file) => resolveSetupFile(file, rootDir));
  config.coverageInclude = coverageFilter(config.collectCoverageFrom, rootDir);
  // Workers load the plugins from the config file, which costs an import: only when it has some that transform.
  config.transformPlugins = [config.plugins ?? []]
    .flat(Infinity)
    .some((plugin) => typeof plugin?.transform === 'function');
  // vitest's test.env: the variables the tests see, set before any worker starts so they all inherit them.
  Object.entries(config.env ?? {}).forEach(([name, value]) => {
    process.env[name] = String(value);
  });
  return config;
}

module.exports = { loadConfig, importConfig, DEFAULTS };
