const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { globToRegExp } = require('./glob');

const DEFAULTS = {
  roots: ['.'],
  include: ['**/*.{test,spec}.?(c|m)[jt]s?(x)', '**/__tests__/**/*.?(c|m)[jt]s?(x)'],
  exclude: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/coverage/**'],
  // Regular expressions (Jest's testPathIgnorePatterns) matched against the path of every test file.
  excludePatterns: [],
  testTimeout: 5000,
  hookTimeout: undefined,
  setupFiles: [],
  // Project modules are loaded fresh for every test file; node_modules stay loaded.
  isolate: true,
  // threads: worker threads; inline: everything in the main thread.
  pool: 'threads',
  maxWorkers: undefined,
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
};

const CONFIG_FILES = ['vynta.config.js', 'vynta.config.cjs', 'vynta.config.mjs'];
const JEST_FILES = ['jest.config.js', 'jest.config.cjs', 'jest.config.mjs', 'jest.config.json'];

async function importConfig(file) {
  if (file.endsWith('.json')) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  // eslint-disable-next-line global-require -- loading the config file is the point
  const loaded = file.endsWith('.mjs') ? await import(pathToFileURL(file).href) : require(file);
  const config = loaded?.default ?? loaded;
  return typeof config === 'function' ? config() : config;
}

function readPackageJson(rootDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  } catch {
    return {};
  }
}

const resolveRootDir = (value, rootDir) => (typeof value === 'string' ? value.replaceAll('<rootDir>', rootDir) : value);

// The options of a Jest config vynta understands, so a Jest project runs without a vynta config.
function fromJestConfig(jest, rootDir) {
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
  ];
  copy
    .filter((key) => jest[key] !== undefined)
    .forEach((key) => {
      config[key] = jest[key];
    });
  if (jest.collectCoverage) {
    config.coverage = true;
  }
  const setupFiles = [...(jest.setupFiles ?? []), ...(jest.setupFilesAfterEnv ?? [])];
  if (setupFiles.length > 0) {
    config.setupFiles = setupFiles.map((file) => resolveRootDir(file, rootDir));
  }
  if (jest.testMatch) {
    config.include = jest.testMatch.map((glob) => resolveRootDir(glob, rootDir).replace(/^.*\*\*\//, '**/'));
  }
  if (jest.testPathIgnorePatterns) {
    config.excludePatterns = jest.testPathIgnorePatterns.map((pattern) => resolveRootDir(pattern, rootDir));
  }
  if (jest.roots) {
    config.roots = jest.roots.map((root) => resolveRootDir(root, rootDir));
  }
  return config;
}

async function findConfig(rootDir, explicit) {
  if (explicit) {
    return importConfig(path.resolve(rootDir, explicit));
  }
  const own = CONFIG_FILES.map((name) => path.join(rootDir, name)).find((file) => fs.existsSync(file));
  if (own) {
    return importConfig(own);
  }
  const pkg = readPackageJson(rootDir);
  if (pkg.vynta) {
    return pkg.vynta;
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

async function loadConfig(cliOptions) {
  const rootDir = path.resolve(cliOptions.rootDir ?? process.cwd());
  const fileConfig = await findConfig(rootDir, cliOptions.config);
  const config = { ...DEFAULTS, ...fileConfig, ...cliOptions, rootDir };
  config.setupFiles = config.setupFiles.map((file) => path.resolve(rootDir, file));
  config.coverageInclude = coverageFilter(config.collectCoverageFrom, rootDir);
  return config;
}

module.exports = { loadConfig, DEFAULTS };
