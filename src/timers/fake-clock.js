/* eslint-disable no-await-in-loop -- the async variants let promises settle between one timer and the next */
const { realTimers, flushMicrotasks } = require('./real-timers');

const DEFAULT_LOOP_LIMIT = 100000;

// What a fake timer handle looks like to the code under test: the same methods as a Node.js Timeout.
function createHandle(clock, timer) {
  const handle = {
    id: timer.id,
    ref: () => {
      timer.ref = true;
      return handle;
    },
    unref: () => {
      timer.ref = false;
      return handle;
    },
    hasRef: () => timer.ref,
    refresh: () => {
      timer.time = clock.now + timer.delay;
      return handle;
    },
    close: () => {
      clock.timers.delete(timer.id);
      return handle;
    },
    [Symbol.toPrimitive]: () => timer.id,
  };
  return handle;
}

const FRAME_MS = 16;
const IDLE_PERIOD_MS = 50;

// A fake clock: timers are kept in a map and only run when the test moves the time, or, with
// shouldAdvanceTime, also as real time passes, `advanceTimeDelta` ms at a time.
class FakeClock {
  #saved = new Map();

  #nextId = 1;

  #advancing = null;

  constructor({
    now = realTimers.Date.now(),
    toFake,
    loopLimit = DEFAULT_LOOP_LIMIT,
    shouldAdvanceTime = false,
    advanceTimeDelta = 20,
  } = {}) {
    this.now = Number(now);
    this.origin = this.now;
    this.timers = new Map();
    this.toFake = new Set(toFake);
    this.loopLimit = loopLimit;
    this.advanceTime = shouldAdvanceTime ? advanceTimeDelta : 0;
    this.firing = 0;
  }

  add(type, callback, delay, args) {
    if (typeof callback !== 'function') {
      throw new TypeError(`The "callback" argument must be of type function. Received ${typeof callback}`);
    }
    const id = this.#nextId;
    this.#nextId += 1;
    const ms = type === 'immediate' ? 0 : this.delayOf(type, delay);
    const timer = { id, type, callback, args, delay: ms, time: this.now + ms, ref: true };
    this.timers.set(id, timer);
    return createHandle(this, timer);
  }

  // As in @sinonjs/fake-timers, which Jest and vitest use: a timeout of 0 is due now (advanceTimersByTime(0) runs
  // it), but 1ms when set from a timer's callback, so a chain of them can not keep a tick going; intervals take 1ms
  // at least.
  delayOf(type, delay) {
    const ms = Math.max(0, Math.trunc(Number(delay)) || 0);
    if (type === 'interval' || this.firing > 0) {
      return Math.max(1, ms);
    }
    return ms;
  }

  clear(handle) {
    if (handle !== undefined && handle !== null) {
      this.timers.delete(typeof handle === 'object' ? handle.id : Number(handle));
    }
  }

  // The next timer due at or before limit, the oldest first when two are due at the same time.
  first(limit = Infinity) {
    let first = null;
    this.timers.forEach((timer) => {
      const earlier = !first || timer.time < first.time || (timer.time === first.time && timer.id < first.id);
      if (timer.time <= limit && earlier) {
        first = timer;
      }
    });
    return first;
  }

  fire(timer) {
    this.now = Math.max(this.now, timer.time);
    if (timer.type === 'interval') {
      timer.time += timer.delay;
    } else {
      this.timers.delete(timer.id);
    }
    this.firing += 1;
    try {
      timer.callback(...timer.args);
    } finally {
      this.firing -= 1;
    }
  }

  checkLoops(count) {
    if (count > this.loopLimit) {
      throw new Error(`Aborting after running ${this.loopLimit} timers, assuming an infinite loop!`);
    }
  }

  tick(ms) {
    const target = this.now + ms;
    for (let timer = this.first(target), count = 1; timer; timer = this.first(target), count += 1) {
      this.checkLoops(count);
      this.fire(timer);
    }
    this.now = target;
  }

  // As tick, letting promise callbacks run between timers.
  async tickAsync(ms) {
    const target = this.now + ms;
    await flushMicrotasks();
    for (let timer = this.first(target), count = 1; timer; timer = this.first(target), count += 1) {
      this.checkLoops(count);
      this.fire(timer);
      await flushMicrotasks();
    }
    this.now = target;
  }

  runAll() {
    for (let timer = this.first(), count = 1; timer; timer = this.first(), count += 1) {
      this.checkLoops(count);
      this.fire(timer);
    }
  }

  async runAllAsync() {
    await flushMicrotasks();
    for (let timer = this.first(), count = 1; timer; timer = this.first(), count += 1) {
      this.checkLoops(count);
      this.fire(timer);
      await flushMicrotasks();
    }
  }

  // Runs the timers pending now, but not the ones they schedule.
  pending() {
    return [...this.timers.values()].sort((a, b) => a.time - b.time || a.id - b.id);
  }

  runPending() {
    this.pending().forEach((timer) => {
      if (this.timers.has(timer.id)) {
        this.fire(timer);
      }
    });
  }

  async runPendingAsync() {
    const pending = this.pending();
    for (let i = 0; i < pending.length; i += 1) {
      await flushMicrotasks();
      if (this.timers.has(pending[i].id)) {
        this.fire(pending[i]);
      }
    }
    await flushMicrotasks();
  }

  next() {
    const timer = this.first();
    if (timer) {
      this.fire(timer);
    }
  }

  // Replaces a global (or process.nextTick) when it is in toFake, saving the original.
  replace(name, target, key, value) {
    if (this.toFake.has(name)) {
      this.#saved.set(name, { target, key, descriptor: Object.getOwnPropertyDescriptor(target, key) });
      Object.defineProperty(target, key, { value, writable: true, configurable: true });
    }
  }

  fakePerformance(real) {
    const prototype = Object.getPrototypeOf(real) ?? {};
    const fake = {};
    Object.getOwnPropertyNames(prototype)
      .filter(
        (name) =>
          name !== 'constructor' && typeof Object.getOwnPropertyDescriptor(prototype, name)?.value === 'function'
      )
      .forEach((name) => {
        fake[name] = name.startsWith('getEntries') ? () => [] : () => undefined;
      });
    const entry = (name, entryType, duration) => ({ name, entryType, startTime: 0, duration, toJSON: () => ({}) });
    return Object.assign(fake, {
      now: () => this.now - this.origin,
      timeOrigin: this.origin,
      mark: (name) => entry(name, 'mark', 0),
      measure: (name) => entry(name, 'measure', 100),
    });
  }

  fakeDate() {
    const clock = this;
    const RealDate = realTimers.Date;
    function FakeDate(...args) {
      if (!new.target) {
        return new RealDate(clock.now).toString();
      }
      return args.length === 0 ? new RealDate(clock.now) : new RealDate(...args);
    }
    FakeDate.prototype = RealDate.prototype;
    FakeDate.now = () => clock.now;
    FakeDate.parse = RealDate.parse;
    FakeDate.UTC = RealDate.UTC;
    Object.defineProperty(FakeDate, Symbol.hasInstance, { value: (value) => value instanceof RealDate });
    return FakeDate;
  }

  install() {
    const g = globalThis;
    this.replace('setTimeout', g, 'setTimeout', (cb, delay, ...args) => this.add('timeout', cb, delay, args));
    this.replace('clearTimeout', g, 'clearTimeout', (handle) => this.clear(handle));
    this.replace('setInterval', g, 'setInterval', (cb, delay, ...args) => this.add('interval', cb, delay, args));
    this.replace('clearInterval', g, 'clearInterval', (handle) => this.clear(handle));
    this.replace('setImmediate', g, 'setImmediate', (cb, ...args) => this.add('immediate', cb, 0, args));
    this.replace('clearImmediate', g, 'clearImmediate', (handle) => this.clear(handle));
    this.replace('queueMicrotask', g, 'queueMicrotask', (cb) => this.add('immediate', cb, 0, []));
    this.replace('nextTick', process, 'nextTick', (cb, ...args) => this.add('immediate', cb, 0, args));
    this.replace('Date', g, 'Date', this.fakeDate());
    // As sinon does: the global becomes a performance of its own. Code that kept the real one (React's
    // scheduler) keeps real time, and a spy a test puts on performance.now() reaches only the fake.
    if (g.performance) {
      this.replace('performance', g, 'performance', this.fakePerformance(g.performance));
    }
    // A document's frame and idle callbacks, as sinon fakes them; only where the environment has them.
    if (typeof g.requestAnimationFrame === 'function') {
      this.replace('requestAnimationFrame', g, 'requestAnimationFrame', (cb) =>
        this.add('timeout', () => cb(this.now - this.origin), FRAME_MS - ((this.now - this.origin) % FRAME_MS), [])
      );
      this.replace('cancelAnimationFrame', g, 'cancelAnimationFrame', (handle) => this.clear(handle));
    }
    if (typeof g.requestIdleCallback === 'function') {
      this.replace('requestIdleCallback', g, 'requestIdleCallback', (cb, options) => {
        const idle = this.timers.size > 0 ? IDLE_PERIOD_MS : 0;
        const delay = options?.timeout ? Math.min(options.timeout, idle) : idle;
        return this.add('timeout', () => cb({ didTimeout: false, timeRemaining: () => IDLE_PERIOD_MS }), delay, []);
      });
      this.replace('cancelIdleCallback', g, 'cancelIdleCallback', (handle) => this.clear(handle));
    }
    if (this.advanceTime > 0) {
      this.#advancing = realTimers.setInterval(() => this.tick(this.advanceTime), this.advanceTime);
      this.#advancing.unref?.();
    }
  }

  uninstall() {
    if (this.#advancing) {
      realTimers.clearInterval(this.#advancing);
      this.#advancing = null;
    }
    this.#saved.forEach(({ target, key, descriptor }) => {
      if (descriptor) {
        Object.defineProperty(target, key, descriptor);
      } else {
        delete target[key];
      }
    });
    this.#saved.clear();
  }
}

module.exports = { FakeClock };
