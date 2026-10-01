const path = require('node:path');
const state = require('../state');
const { formatTitle, normalizeTable } = require('./each');
const { Suite } = require('./suite');
const { TestCase } = require('./test-case');

// Chainable modifiers: it.skip, it.only.each, describe.concurrent...
const MODIFIERS = ['skip', 'only', 'todo', 'concurrent', 'sequential', 'fails', 'shuffle'];
const MODIFIER_ALIASES = { failing: 'fails' };

function currentSuite(kind) {
  if (!state.suite) {
    throw new Error(`${kind}() can only be called while a test file is being collected`);
  }
  return state.suite;
}

function modeOf({ todo, skip, only }) {
  if (todo) {
    return 'todo';
  }
  if (skip) {
    return 'skip';
  }
  return only ? 'only' : 'run';
}

const toOptions = (options) => (typeof options === 'number' ? { timeout: options } : (options ?? {}));

const titleOf = (name) => (typeof name === 'function' ? name.name : String(name));

// vitest also accepts (name, options, fn).
const normalizeArgs = (fn, options) =>
  typeof fn === 'object' && typeof options === 'function' ? [options, fn] : [fn, options];

function registerSuite(name, fnArg, optionsArg, flags) {
  const [fn, rawOptions] = normalizeArgs(fnArg, optionsArg);
  const parent = currentSuite('describe');
  const options = { ...toOptions(rawOptions) };
  if (flags.concurrent || flags.sequential) {
    options.concurrent = Boolean(flags.concurrent) && !flags.sequential;
  }
  const mode =
    fn === undefined
      ? 'todo'
      : modeOf({ ...flags, skip: flags.skip || options.skip, only: flags.only || options.only });
  if (mode === 'only') {
    state.file.hasOnly = true;
  }
  const suite = new Suite(titleOf(name), parent, mode, options);
  parent.children.push(suite);
  if (typeof fn === 'function') {
    state.suite = suite;
    try {
      const result = fn();
      if (typeof result?.then === 'function') {
        state.file.pendingCollections.push({ suite, promise: result });
      }
    } catch (error) {
      suite.collectError = error;
    } finally {
      state.suite = parent;
    }
  }
  return suite;
}

function registerTest(name, fnArg, optionsArg, flags) {
  const [fn, rawOptions] = normalizeArgs(fnArg, optionsArg);
  const parent = currentSuite('test');
  const options = toOptions(rawOptions);
  const mode = modeOf({
    todo: flags.todo || options.todo || fn === undefined,
    skip: flags.skip || options.skip,
    only: flags.only || options.only,
  });
  if (mode === 'only') {
    state.file.hasOnly = true;
  }
  const test = new TestCase(titleOf(name), fn, parent, mode, options, flags);
  // Position in the file, which split files use to share out the tests and to merge their results back in order.
  test.index = state.file.testCount;
  state.file.testCount += 1;
  parent.children.push(test);
  return test;
}

// The function a .each() case runs: array cases are spread, and a trailing `done` is kept for Jest.
function eachCase(fn, row, isSuite) {
  if (typeof fn !== 'function') {
    return fn;
  }
  const args = row.spread ? row.values : [row.values];
  if (!isSuite && fn.length > args.length) {
    return function eachWithDone(done) {
      return fn(...args, done);
    };
  }
  return () => fn(...args);
}

function createApi(register, flags) {
  const isSuite = register === registerSuite;
  const api = (name, fn, options) => register(name, fn, options, flags);
  const withFlags = (extra) => createApi(register, { ...flags, ...extra });
  [...MODIFIERS, ...Object.keys(MODIFIER_ALIASES)].forEach((modifier) => {
    Object.defineProperty(api, modifier, {
      get: () => withFlags({ [MODIFIER_ALIASES[modifier] ?? modifier]: true }),
    });
  });
  api.skipIf = (condition) => (condition ? withFlags({ skip: true }) : api);
  api.runIf = (condition) => (condition ? api : withFlags({ skip: true }));
  api.each =
    (...table) =>
    (name, fn, options) =>
      normalizeTable(table).forEach((row, i) => {
        register(formatTitle(name, row, i), eachCase(fn, row, isSuite), options, flags);
      });
  // vitest's test.for: the case is passed as is, followed by the test context.
  api.for =
    (...table) =>
    (name, fn, options) =>
      normalizeTable(table).forEach((row, i) => {
        const run = typeof fn === 'function' ? (context) => fn(row.values, context) : fn;
        register(formatTitle(name, row, i), run, options, flags);
      });
  if (!isSuite) {
    // vitest fixtures.
    api.extend = (fixtures) => withFlags({ fixtures: { ...flags.fixtures, ...fixtures } });
    api.scoped = () => {};
  }
  return api;
}

const describe = createApi(registerSuite, {});
const test = createApi(registerTest, {});

const RUNTIME_DIR = path.dirname(__dirname);

const NODE_MODULES = `${path.sep}node_modules${path.sep}`;

// The package whose code is calling into vyntra now (the first frame outside vyntra's own), if the
// caller lives in node_modules.
function callingPackage() {
  const frames = (new Error().stack ?? '').split('\n').slice(1);
  const caller = frames.find((frame) => /[\\/]/.test(frame) && !frame.includes(RUNTIME_DIR));
  const index = caller?.lastIndexOf(NODE_MODULES) ?? -1;
  if (index === -1) {
    return null;
  }
  const parts = caller.slice(index + NODE_MODULES.length).split(/[\\/]/);
  return parts.slice(0, parts[0].startsWith('@') ? 2 : 1).join('/');
}

// A library that registers a root hook as it loads (user-event's clipboard reset, Testing Library's
// cleanup) loads once per thread here, not once per file: the hook is kept and given to every later
// file that imports the library, as a fresh load would.
const hook = (kind) => (fn, timeout) => {
  const suite = currentSuite(kind);
  suite.hooks[kind].push({ fn, timeout });
  const dependency = suite === state.file?.root ? callingPackage() : null;
  if (dependency) {
    state.dependencyHooks = [...(state.dependencyHooks ?? []), { kind, fn, timeout, dependency }];
  }
};

function currentTest(kind) {
  if (!state.test) {
    throw new Error(`${kind}() can only be called inside a test`);
  }
  return state.test;
}

module.exports = {
  describe,
  suite: describe,
  test,
  it: test,
  beforeAll: hook('beforeAll'),
  afterAll: hook('afterAll'),
  beforeEach: hook('beforeEach'),
  afterEach: hook('afterEach'),
  onTestFinished: (fn) => currentTest('onTestFinished').onFinished.push(fn),
  onTestFailed: (fn) => currentTest('onTestFailed').onFailed.push(fn),
  callingPackage,
};
