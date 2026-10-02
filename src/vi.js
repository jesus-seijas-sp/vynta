const state = require('./state');
const mock = require('./mock');
const { timers, realTimers } = require('./timers');
const { waitFor, waitUntil } = require('./wait');
const modules = require('./modules/api');

const stubbedGlobals = new Map();
const stubbedEnvs = new Map();

function unstubAllGlobals() {
  stubbedGlobals.forEach((descriptor, name) => {
    if (descriptor) {
      Object.defineProperty(globalThis, name, descriptor);
    } else {
      delete globalThis[name];
    }
  });
  stubbedGlobals.clear();
}

function unstubAllEnvs() {
  stubbedEnvs.forEach((value, name) => {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  });
  stubbedEnvs.clear();
}

// The vi object of vitest, also exposed as jest. Methods that configure something return it, for chaining.
const vi = {
  ...timers,
  fn: mock.fn,
  spyOn: mock.spyOn,
  isMockFunction: mock.isMockFunction,
  mocked: (value) => value,
  waitFor,
  waitUntil,
  hoisted: (factory) => factory(),
  dynamicImportSettled: () =>
    new Promise((resolve) => {
      realTimers.setImmediate(resolve);
    }),
  ...modules,
};

const chained = {
  clearAllMocks: mock.clearAllMocks,
  resetAllMocks: mock.resetAllMocks,
  restoreAllMocks: mock.restoreAllMocks,
  useFakeTimers: timers.useFakeTimers,
  useRealTimers: timers.useRealTimers,
  setSystemTime: timers.setSystemTime,
  runAllTimers: timers.runAllTimers,
  runOnlyPendingTimers: timers.runOnlyPendingTimers,
  advanceTimersByTime: timers.advanceTimersByTime,
  advanceTimersToNextTimer: timers.advanceTimersToNextTimer,
  clearAllTimers: timers.clearAllTimers,
  unstubAllGlobals,
  unstubAllEnvs,
  resetModules: modules.resetModules,
  mock: modules.mock,
  doMock: modules.doMock,
  unmock: modules.unmock,
  doUnmock: modules.doUnmock,
  // Jest's names for doUnmock and for unmocking a module with what it requires.
  dontMock: modules.doUnmock,
  deepUnmock: modules.unmock,
  setTimeout: (ms) => {
    state.config.testTimeout = ms;
  },
  setConfig: ({ testTimeout } = {}) => {
    if (testTimeout) {
      state.config.testTimeout = testTimeout;
    }
  },
  retryTimes: (count) => {
    state.config.retry = count;
  },
  stubGlobal: (name, value) => {
    if (!stubbedGlobals.has(name)) {
      stubbedGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    }
    Object.defineProperty(globalThis, name, { value, writable: true, configurable: true, enumerable: true });
  },
  stubEnv: (name, value) => {
    if (!stubbedEnvs.has(name)) {
      stubbedEnvs.set(name, process.env[name]);
    }
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = String(value);
    }
  },
};

Object.entries(chained).forEach(([name, method]) => {
  vi[name] = (...args) => {
    method(...args);
    return vi;
  };
});

// Undoes what a test file stubbed; called when the file ends.
function releaseStubs() {
  unstubAllGlobals();
  unstubAllEnvs();
}

globalThis[Symbol.for('vyntra.vi')] = vi;

module.exports = { vi, releaseStubs };
