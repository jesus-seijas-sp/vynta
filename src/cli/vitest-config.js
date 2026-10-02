const path = require('node:path');

// Read in this order when there is no vyntra config: a vite.config counts only when it has a `test` section.
const VITEST_CONFIG_FILES = ['vitest.config', 'vite.config'].flatMap((name) =>
  ['ts', 'mts', 'cts', 'js', 'mjs', 'cjs'].map((ext) => `${name}.${ext}`)
);

const isVitestConfig = (config) => config !== null && typeof config?.test === 'object';

// Options of the same name and meaning in both.
const SAME = [
  'include',
  'exclude',
  'testTimeout',
  'hookTimeout',
  'retry',
  'allowOnly',
  'passWithNoTests',
  'maxConcurrency',
  'isolate',
  'silent',
  'clearMocks',
  'restoreMocks',
  'environment',
  'environmentOptions',
  'maxWorkers',
];

const POOLS = { threads: 'threads', vmThreads: 'threads', forks: 'forks', vmForks: 'forks' };

// Vite's alias, as an object ({ '@app': './src' }) or a list ([{ find, replacement }]); a relative replacement is
// taken from the root, as vitest's test.alias is.
function aliasesOf(alias, root) {
  const list = Array.isArray(alias)
    ? alias
    : Object.entries(alias ?? {}).map(([find, replacement]) => ({ find, replacement }));
  return list
    .filter(({ find, replacement }) => find !== undefined && typeof replacement === 'string')
    .map(({ find, replacement }) => ({
      find,
      replacement: /^\.\.?(?:[/\\]|$)/.test(replacement) ? path.resolve(root, replacement) : replacement,
    }));
}

function coverageOf(coverage, config) {
  if (coverage.enabled) {
    config.coverage = true;
  }
  if (coverage.reportsDirectory) {
    config.coverageDirectory = coverage.reportsDirectory;
  }
  if (coverage.reporter) {
    config.coverageReporters = [coverage.reporter].flat().map((reporter) => [reporter].flat()[0]);
  }
  if (coverage.include || coverage.exclude) {
    config.collectCoverageFrom = [
      ...(coverage.include ?? ['**/*']),
      ...(coverage.exclude ?? []).map((glob) => `!${glob}`),
    ];
  }
  const { lines, functions, branches, statements } = coverage.thresholds ?? {};
  const global = Object.fromEntries(
    Object.entries({ lines, functions, branches, statements }).filter(([, value]) => value !== undefined)
  );
  if (Object.keys(global).length > 0) {
    config.coverageThreshold = { global };
  }
}

// The TypeScript options vitest's transformer gets from the config rather than tsconfig.json: Oxc's decorators
// (vite 8), or esbuild's tsconfigRaw.
function compilerOptionsOf(vite) {
  const options = { ...vite.esbuild?.tsconfigRaw?.compilerOptions };
  const decorator = vite.oxc?.decorator;
  if (decorator?.legacy !== undefined) {
    options.experimentalDecorators = decorator.legacy;
  }
  if (decorator?.emitDecoratorMetadata !== undefined) {
    options.emitDecoratorMetadata = decorator.emitDecoratorMetadata;
  }
  const kept = ['experimentalDecorators', 'emitDecoratorMetadata', 'useDefineForClassFields'];
  const picked = Object.fromEntries(
    kept.filter((name) => options[name] !== undefined).map((name) => [name, options[name]])
  );
  return Object.keys(picked).length > 0 ? picked : undefined;
}

// What vyntra does not do, said once rather than silently ignored.
function warnUnsupported(test) {
  const unsupported = [
    test.globalSetup && 'globalSetup',
    (test.projects || test.workspace) && 'projects',
    test.browser?.enabled && 'browser mode',
    test.typecheck?.enabled && 'typecheck',
  ].filter(Boolean);
  if (unsupported.length > 0) {
    process.emitWarning(`vyntra does not run vitest's ${unsupported.join(', ')}; the rest of the config is used`);
  }
}

// The options of a vitest (or Vite) config vyntra understands, so a vitest project runs without a vyntra config.
function fromVitestConfig(vite, rootDir) {
  const test = vite.test ?? {};
  const root = path.resolve(rootDir, test.root ?? vite.root ?? '.');
  const config = {};
  SAME.filter((key) => test[key] !== undefined).forEach((key) => {
    config[key] = test[key];
  });
  if (path.relative(rootDir, root) !== '') {
    config.roots = [root];
  }
  if (test.setupFiles) {
    config.setupFiles = [test.setupFiles]
      .flat()
      .map((file) => (file.startsWith('.') ? path.resolve(root, file) : file));
  }
  if (test.mockReset !== undefined) {
    config.resetMocks = test.mockReset;
  }
  if (test.bail !== undefined) {
    config.bail = test.bail;
  }
  if (POOLS[test.pool]) {
    config.pool = POOLS[test.pool];
  }
  if (test.sequence?.hooks === 'list') {
    config.hookOrder = 'list';
  }
  if (test.env) {
    config.env = test.env;
  }
  // vitest adds test.alias to Vite's resolve.alias, its own coming first.
  const alias = [...aliasesOf(test.alias, root), ...aliasesOf(vite.resolve?.alias, root)];
  if (alias.length > 0) {
    config.alias = alias;
  }
  coverageOf(test.coverage ?? {}, config);
  const compilerOptions = compilerOptionsOf(vite);
  if (compilerOptions) {
    config.compilerOptions = compilerOptions;
  }
  if (vite.plugins) {
    config.plugins = vite.plugins;
  }
  warnUnsupported(test);
  return config;
}

module.exports = { VITEST_CONFIG_FILES, isVitestConfig, fromVitestConfig };
