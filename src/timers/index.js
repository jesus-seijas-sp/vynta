const { FakeClock } = require('./fake-clock');
const { realTimers, flushMicrotasks } = require('./real-timers');

// Faked by default, as in vitest: process.nextTick and queueMicrotask only when asked for.
const DEFAULT_FAKE = [
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
  'setImmediate',
  'clearImmediate',
  'Date',
  'performance',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'requestIdleCallback',
  'cancelIdleCallback',
];

let clock = null;

function requireClock(method) {
  if (!clock) {
    throw new Error(`Timers are not mocked. Call vi.useFakeTimers() before vi.${method}().`);
  }
  return clock;
}

function useFakeTimers(config = {}) {
  clock?.uninstall();
  const { toFake, doNotFake = [], now, loopLimit, shouldAdvanceTime, advanceTimeDelta } = config ?? {};
  clock = new FakeClock({
    now,
    loopLimit,
    shouldAdvanceTime,
    advanceTimeDelta,
    toFake: toFake ?? DEFAULT_FAKE.filter((name) => !doNotFake.includes(name)),
  });
  clock.install();
}

function useRealTimers() {
  clock?.uninstall();
  clock = null;
}

async function advanceTimersToNextTimerAsync(steps = 1) {
  const current = requireClock('advanceTimersToNextTimerAsync');
  for (let i = 0; i < steps; i += 1) {
    // eslint-disable-next-line no-await-in-loop -- promises settle between one timer and the next
    await flushMicrotasks();
    current.next();
  }
  await flushMicrotasks();
}

const timers = {
  useFakeTimers,
  useRealTimers,
  isFakeTimers: () => clock !== null,
  advanceTimersByTime: (ms) => requireClock('advanceTimersByTime').tick(ms),
  advanceTimersByTimeAsync: (ms) => requireClock('advanceTimersByTimeAsync').tickAsync(ms),
  advanceTimersToNextTimer: (steps = 1) => {
    const current = requireClock('advanceTimersToNextTimer');
    for (let i = 0; i < steps; i += 1) {
      current.next();
    }
  },
  advanceTimersToNextTimerAsync,
  runAllTimers: () => requireClock('runAllTimers').runAll(),
  runAllTimersAsync: () => requireClock('runAllTimersAsync').runAllAsync(),
  runOnlyPendingTimers: () => requireClock('runOnlyPendingTimers').runPending(),
  runOnlyPendingTimersAsync: () => requireClock('runOnlyPendingTimersAsync').runPendingAsync(),
  // process.nextTick is not faked by default, so there is nothing to run.
  runAllTicks: () => {},
  clearAllTimers: () => clock?.timers.clear(),
  getTimerCount: () => clock?.timers.size ?? 0,
  setSystemTime: (value) => {
    if (clock) {
      clock.now = value instanceof realTimers.Date ? value.getTime() : Number(new realTimers.Date(value));
    }
  },
  getRealSystemTime: () => realTimers.Date.now(),
  getMockedSystemTime: () => (clock ? new realTimers.Date(clock.now) : null),
};

module.exports = { timers, realTimers, flushMicrotasks };
