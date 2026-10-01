const state = require('../state');

// The real timer functions, taken before any test can fake them. The runner uses them for its own timeouts.
state.realTimers ??= {
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
  setInterval: globalThis.setInterval,
  clearInterval: globalThis.clearInterval,
  setImmediate: globalThis.setImmediate,
  clearImmediate: globalThis.clearImmediate,
  queueMicrotask: globalThis.queueMicrotask,
  nextTick: process.nextTick,
  Date: globalThis.Date,
  performanceNow: performance.now.bind(performance),
};

const { realTimers } = state;

// Lets pending promise callbacks run: a macrotask boundary drains the microtask queue.
const flushMicrotasks = () =>
  new Promise((resolve) => {
    realTimers.setImmediate(resolve);
  });

module.exports = { realTimers, flushMicrotasks };
