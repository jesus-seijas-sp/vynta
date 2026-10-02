const os = require('node:os');
const Module = require('node:module');
const util = require('node:util');
const { isMainThread } = require('node:worker_threads');
const state = require('./state');
const { realTimers } = require('./timers/real-timers');
const { setColors } = require('./colors');
const { CoverageCollector } = require('./coverage/collector');
const { installGlobals } = require('./index');
const { isolateModules, forgetModules } = require('./loader');
const { runFile, reportUncaught } = require('./run/run-file');
const { mocks } = require('./modules/registry');
const { ResolveCache } = require('./resolve-cache');
const { releaseStubs } = require('./vi');
const {
  install: installEnvironment,
  teardown: teardownEnvironment,
  settle: settleEnvironment,
  environmentOf,
} = require('./environment');
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
      } else if (silent !== true) {
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

function signalName(number) {
  return Object.keys(os.constants.signals).find((name) => os.constants.signals[name] === number);
}

// A test that signals its own process (Nest's shutdown hooks: process.kill(process.pid, 'SIGTERM')) expects what
// POSIX does: the process's listeners get the signal, or, with none, the process ends. On Windows the process ends
// whatever listens, and for a worker thread the process is the whole run. So the signal goes to the listeners, and
// without them only the worker ends, as a Jest or vitest worker process would.
function shimProcessKill() {
  const kill = process.kill.bind(process);
  process.kill = function vyntraKill(pid, signal = 'SIGTERM') {
    const name = typeof signal === 'number' ? signalName(signal) : signal;
    if (Number(pid) !== process.pid || !name) {
      return kill(pid, signal);
    }
    if (process.listenerCount(name) > 0) {
      realTimers.setImmediate(() => process.emit(name, name));
      return true;
    }
    if (isMainThread) {
      return kill(pid, signal);
    }
    process.exit(128 + os.constants.signals[name]);
    return true;
  };
}

// A worker thread's process.stdin/stdout/stderr are streams of the thread, not of the process: given to a child
// process as its stdio (a shell running commands with the test's own streams), Node refuses them. In a Jest worker
// they are the worker process's pipes, which no test writes to: the child gets no input, and writes where the
// process does.
function shimWorkerStdio() {
  if (isMainThread) {
    return;
  }
  // eslint-disable-next-line global-require -- only worker threads need it
  const { ChildProcess } = require('node:child_process');
  const replacement = (stream) => {
    if (stream === process.stdin) {
      return 'ignore';
    }
    return stream === process.stdout || stream === process.stderr ? 'inherit' : stream;
  };
  const { spawn } = ChildProcess.prototype;
  ChildProcess.prototype.spawn = function spawnWithWorkerStdio(options) {
    const stdio = Array.isArray(options?.stdio) ? options.stdio.map(replacement) : options?.stdio;
    return spawn.call(this, stdio === options?.stdio ? options : { ...options, stdio });
  };
}

let settling = false;

// Aborts the finished file's pending document work, and lets the rejections that causes go by.
async function settle() {
  settling = true;
  try {
    await settleEnvironment();
  } catch {
    // A document that can not be stopped is torn down all the same.
  }
  await new Promise((resolve) => {
    realTimers.setImmediate(resolve);
  });
  settling = false;
}

// The promises whose rejections were reported as unhandled, until one is handled after all.
const unhandled = new WeakMap();

function catchUncaught() {
  process.on('uncaughtException', (error) => {
    if (!reportUncaught(error)) {
      throw error;
    }
  });
  process.on('unhandledRejection', (reason, promise) => {
    // What stopping a finished file's document rejects is no one's failure.
    if (settling && reason?.name === 'AbortError') {
      return;
    }
    // A test listening for unhandled rejections itself has taken them on, as in plain Node.
    if (process.listenerCount('unhandledRejection') > 1) {
      return;
    }
    if (!reportUncaught(reason)) {
      throw reason;
    }
    unhandled.set(promise, reason);
  });
  // A rejection the test handles later (a promise rejected while fake timers run, awaited with .rejects afterwards)
  // was never the test's failure: Jest does not count it, and Node says when it happens.
  process.on('rejectionHandled', (promise) => {
    const reason = unhandled.get(promise);
    const pending = state.file?.uncaught ?? [];
    if (unhandled.delete(promise) && pending.includes(reason)) {
      pending.splice(pending.indexOf(reason), 1);
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
  shimProcessKill();
  shimWorkerStdio();
  await loadPlugins(config);
  const pristine = globalSnapshot.snapshot();
  const pristineEnv = globalSnapshot.snapshotEnv();
  globalSnapshot.keepGlobalsRemovable();
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
    await settle();
    releaseStubs();
    globalSnapshot.restoreEnv(pristineEnv);
    forgetModules(mocks.stale());
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
