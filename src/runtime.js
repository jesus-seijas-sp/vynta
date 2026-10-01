const Module = require('node:module');
const util = require('node:util');
const state = require('./state');
const { setColors } = require('./colors');
const { CoverageCollector } = require('./coverage/collector');
const { installGlobals } = require('./index');
const { isolateModules } = require('./loader');
const { runFile, reportUncaught } = require('./run/run-file');
const { mocks } = require('./modules/registry');
const { ResolveCache } = require('./resolve-cache');
const { releaseStubs } = require('./vi');
const { install: installEnvironment, teardown: teardownEnvironment, environmentOf } = require('./environment');
const globalSnapshot = require('./global-snapshot');
const { loadPlugins } = require('./plugins');

const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug', 'trace', 'dir'];

// Console output of a test file is kept with its results (and the test that wrote it), so the reporter can print
// it in order instead of interleaved with other files.
function captureConsole(silent) {
  CONSOLE_METHODS.forEach((type) => {
    // eslint-disable-next-line no-console -- replacing the console methods
    const original = console[type].bind(console);
    // eslint-disable-next-line no-console
    console[type] = (...args) => {
      const { file, test } = state;
      if (!file) {
        original(...args);
      } else if (!silent) {
        const text = type === 'dir' ? util.inspect(args[0], args[1]) : util.format(...args);
        file.console.push({ type, test: test?.fullName, text });
      }
    };
  });
}

// Jest runs tests in child processes, so code under test may call process.send() (cluster messages, for example)
// and work there. In a worker thread there is no process.send: messages sent through this one go nowhere, as the
// ones Jest's workers send to a parent that ignores them.
function shimProcessSend() {
  if (typeof process.send === 'function') {
    return;
  }
  process.send = (message, ...rest) => {
    rest.find((arg) => typeof arg === 'function')?.(null);
    return true;
  };
}

function catchUncaught() {
  process.on('uncaughtException', (error) => {
    if (!reportUncaught(error)) {
      throw error;
    }
  });
  process.on('unhandledRejection', (reason) => {
    // A test listening for unhandled rejections itself has taken them on, as in plain Node.
    if (process.listenerCount('unhandledRejection') > 1) {
      return;
    }
    if (!reportUncaught(reason)) {
      throw reason;
    }
  });
}

// Loading the project's dependencies is the first thing every thread does, and on large projects the slowest:
// resolutions found in earlier runs are reused, and V8 keeps the compiled code on disk.
function speedUpLoading(config) {
  if (config.compileCacheDir) {
    Module.enableCompileCache?.(config.compileCacheDir);
  }
  if (!config.resolveCache) {
    return null;
  }
  const cache = ResolveCache.load(config.resolveCache);
  cache.install();
  return cache;
}

// Prepares this thread to run test files: { run(path), finish() }, finish giving what the thread collected over the
// run (coverage, new module resolutions).
async function createRuntime(config) {
  state.config = config;
  setColors(config.colors);
  const resolutions = speedUpLoading(config);
  installGlobals();
  captureConsole(config.silent);
  catchUncaught();
  shimProcessSend();
  await loadPlugins(config);
  const pristine = globalSnapshot.snapshot();
  installEnvironment(config);
  let installed = config.environment ?? 'node';
  // A document keeps cookies, storage and nodes, which the next file must not inherit.
  const switchEnvironment = (environment) => {
    teardownEnvironment();
    globalSnapshot.restore(pristine);
    installEnvironment({ ...config, environment });
    installed = environment;
  };
  const coverage = config.coverage ? new CoverageCollector(config) : null;
  await coverage?.start();
  const run = async (path, shard) => {
    const wanted = environmentOf(path) ?? config.environment ?? 'node';
    if (wanted !== installed) {
      switchEnvironment(wanted);
    }
    const result = await runFile(path, { ...config, environment: wanted }, shard);
    releaseStubs();
    mocks.clear();
    // Before the modules of the file are released.
    await coverage?.take();
    if (config.isolate !== false) {
      isolateModules();
      switchEnvironment(installed);
    }
    return result;
  };
  const finish = async () => ({ coverage: coverage ? await coverage.stop() : null, resolutions: resolutions?.added });
  return { run, finish };
}

module.exports = { createRuntime };
