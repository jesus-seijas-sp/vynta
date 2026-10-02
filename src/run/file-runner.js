/* eslint-disable no-await-in-loop -- hooks and tests run one after the other, in order, by definition */
const state = require('../state');
const { expect } = require('../expect');
const { clearAllMocks, resetAllMocks, restoreAllMocks } = require('../mock');
const { realTimers } = require('../timers');
const { FixtureSet } = require('./fixtures');
const { invoke } = require('./invoke');
const { serializeError } = require('./serialize-error');
const { SkipError } = require('./skip-error');

const now = realTimers.performanceNow;

function assertionCountError(test) {
  const { expectedAssertions: expected, assertions: actual } = test;
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  if (expected !== undefined && expected !== null && actual !== expected) {
    return new Error(
      `expect.assertions(${expected})\n\nExpected ${plural(expected, 'assertion')} to be called but received ${plural(actual, 'assertion call')}.`
    );
  }
  if (test.hasAssertions && actual === 0) {
    return new Error('expect.hasAssertions()\n\nExpected at least one assertion to be called but received none.');
  }
  return null;
}

// Runs the collected tree of one file and records a result for every test.
class FileRunner {
  constructor(file, config) {
    this.file = file;
    this.config = config;
    this.results = [];
  }

  get testTimeout() {
    return this.config.testTimeout;
  }

  // vitest runs the after hooks of a suite last-registered first ('stack'); Jest in declaration order ('list').
  afterHooks(hooks) {
    return this.config.hookOrder === 'list' ? hooks : [...hooks].reverse();
  }

  get hookTimeout() {
    return this.config.hookTimeout ?? this.config.testTimeout;
  }

  // The vitest test context; also what a Jest done callback carries.
  createContext(test, record) {
    return {
      task: {
        name: test.name,
        fullName: test.fullName,
        mode: test.mode,
        file: { name: this.file.path, filepath: this.file.path },
        suite: test.parent ? { name: test.parent.name } : undefined,
        meta: {},
        result: record,
      },
      expect,
      skip: (condition, note) => {
        if (typeof condition !== 'boolean') {
          throw new SkipError(condition);
        }
        if (condition) {
          throw new SkipError(note);
        }
      },
      onTestFinished: (fn) => test.onFinished.push(fn),
      onTestFailed: (fn) => test.onFailed.push(fn),
      signal: test.abort.signal,
      annotate: () => Promise.resolve(),
    };
  }

  async runHooks(hooks, context, collect) {
    for (let i = 0; i < hooks.length; i += 1) {
      const { fn, timeout } = hooks[i];
      const result = await invoke(fn, context, timeout ?? this.hookTimeout, 'hook');
      collect?.(result);
    }
  }

  // Runs functions that must all run even when some fail (after hooks, cleanups); returns their errors.
  static async runAll(fns) {
    const errors = [];
    for (let i = 0; i < fns.length; i += 1) {
      try {
        await fns[i]();
      } catch (error) {
        errors.push(error);
      }
    }
    return errors;
  }

  applyMockConfig() {
    if (this.config.clearMocks) {
      clearAllMocks();
    }
    if (this.config.resetMocks) {
      resetAllMocks();
    }
    if (this.config.restoreMocks) {
      restoreAllMocks();
    }
  }

  // The body of one attempt: beforeEach hooks, fixtures, the test and the assertion checks.
  async runBody(test, context, cleanups, fixtures) {
    const suites = test.parent.path;
    for (let i = 0; i < suites.length; i += 1) {
      await this.runHooks(suites[i].hooks.beforeEach, context, (result) => {
        // vitest: a beforeEach may return its cleanup.
        if (typeof result === 'function') {
          cleanups.push(result);
        }
      });
    }
    if (fixtures) {
      await fixtures.setup(test.fn);
    }
    const timeout = test.timeout ?? this.testTimeout;
    await invoke(test.fn, context, timeout, 'test');
    await this.checkUnawaited(test, timeout);
    const countError = assertionCountError(test);
    if (countError) {
      throw countError;
    }
  }

  // Assertions the test did not await (expect(promise).resolves... without await): their failures would be lost.
  // vitest waits for them, within the test's timeout; Jest drops them, so under a Jest config only those that fail
  // straight away count, and one that never settles (a promise of a stream never ended) does not hold the run.
  async checkUnawaited(test, timeout) {
    const unawaited = test.pendingAssertions.filter((entry) => !entry.handled);
    if (unawaited.length === 0) {
      return;
    }
    const outcomes = unawaited.map((entry) =>
      entry.promise.then(
        () => null,
        (reason) => ({ reason })
      )
    );
    const all = Promise.all(outcomes);
    if (this.config.unawaitedAssertions === 'settled') {
      const turn = new Promise((resolve) => {
        realTimers.setImmediate(() => resolve([]));
      });
      const failed = (await Promise.race([all, turn])).find(Boolean);
      if (failed) {
        throw failed.reason;
      }
      return;
    }
    let timer;
    const expired = new Promise((resolve, reject) => {
      timer = realTimers.setTimeout(() => {
        reject(
          new Error(
            `An assertion the test did not await (expect(...).resolves or .rejects without await) had not settled ${timeout}ms after the test ended. Await it, or the promise it checks never settles.`
          )
        );
      }, timeout);
    });
    try {
      const failed = (await Promise.race([all, expired])).find(Boolean);
      if (failed) {
        throw failed.reason;
      }
    } finally {
      realTimers.clearTimeout(timer);
    }
  }

  // One attempt of a test: { errors, skipped }.
  async runAttempt(test, record) {
    test.reset();
    const context = this.createContext(test, record);
    const cleanups = [];
    const fixtures = test.fixtures ? new FixtureSet(test.fixtures, context) : null;
    const errors = [];
    let skipped = false;
    state.test = test;
    this.applyMockConfig();
    try {
      await this.runBody(test, context, cleanups, fixtures);
    } catch (error) {
      if (error instanceof SkipError) {
        skipped = true;
      } else {
        errors.push(error);
      }
    }
    errors.push(...test.softErrors);
    test.abort.abort();
    // afterEach from the innermost suite out, then the beforeEach cleanups and the fixtures in reverse.
    const suites = test.parent.path.reverse();
    const afterEach = suites.map((suite) => () => this.runHooks(this.afterHooks(suite.hooks.afterEach), context));
    errors.push(...(await FileRunner.runAll(afterEach)));
    errors.push(...(await FileRunner.runAll(cleanups.reverse())));
    if (fixtures) {
      errors.push(...(await fixtures.teardown()));
    }
    if (errors.length > 0) {
      errors.push(...(await FileRunner.runAll(test.onFailed.map((fn) => () => fn(context)))));
    }
    errors.push(...(await FileRunner.runAll(test.onFinished.reverse().map((fn) => () => fn(context)))));
    // A rejection reported as unhandled may have been handled since: Node says so on its next turn (see
    // catchUncaught in runtime.js), which comes before these errors are the test's.
    if (this.file.uncaught.length > 0) {
      await new Promise((resolve) => {
        realTimers.setImmediate(resolve);
      });
    }
    errors.push(...this.file.uncaught.splice(0));
    state.test = null;
    return { errors, skipped };
  }

  // Attempts with retries and repeats: stops at the first failure, retries while there are retries left.
  async runAttempts(test, record) {
    const retries = test.retry ?? this.config.retry ?? 0;
    let outcome;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      for (let repeat = 0; repeat <= test.repeats; repeat += 1) {
        outcome = await this.runAttempt(test, record);
        if (outcome.errors.length > 0 || outcome.skipped) {
          break;
        }
      }
      if (outcome.errors.length === 0 || outcome.skipped) {
        return outcome;
      }
      record.retries = attempt + 1;
    }
    return outcome;
  }

  async runTest(test) {
    const record = {
      name: test.fullName,
      path: test.titlePath,
      index: test.index,
      status: 'passed',
      duration: 0,
      errors: [],
    };
    this.results.push(record);
    if (test.mode !== 'run') {
      record.status = test.mode === 'todo' ? 'todo' : 'skipped';
      return record;
    }
    if (test.failError) {
      Object.assign(record, { status: 'failed', errors: [serializeError(test.failError)] });
      return record;
    }
    const start = now();
    const { errors, skipped } = await this.runAttempts(test, record);
    record.duration = now() - start;
    if (skipped) {
      record.status = 'skipped';
    } else if (test.fails) {
      // .fails inverts the result.
      record.status = errors.length > 0 ? 'passed' : 'failed';
      record.errors = errors.length > 0 ? [] : [serializeError(new Error('Expect test to fail'))];
    } else if (errors.length > 0) {
      Object.assign(record, { status: 'failed', errors: errors.map(serializeError) });
    }
    return record;
  }

  // Runs consecutive concurrent tests, at most maxConcurrency at a time, keeping their order in the results.
  async runConcurrent(tests) {
    const limit = this.config.maxConcurrency ?? 5;
    const records = new Array(tests.length);
    const { results } = this;
    this.results = [];
    let next = 0;
    const worker = async () => {
      while (next < tests.length) {
        const index = next;
        next += 1;
        records[index] = await this.runTest(tests[index]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(limit, tests.length) }, worker));
    this.results = [...results, ...records];
  }

  async runSuite(suite) {
    if (suite.collectError) {
      this.file.errors.push(serializeError(suite.collectError));
    }
    const runnable = suite.hasRunnable();
    let beforeFailed = false;
    if (runnable) {
      try {
        await this.runHooks(suite.hooks.beforeAll);
      } catch (error) {
        beforeFailed = true;
        suite.failAll(error);
      }
    }
    const { children } = suite;
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i];
      if (child.type === 'suite') {
        await this.runSuite(child);
      } else if (child.concurrent && child.mode === 'run' && !beforeFailed) {
        let end = i + 1;
        while (end < children.length && children[end].type === 'test' && children[end].concurrent) {
          end += 1;
        }
        await this.runConcurrent(children.slice(i, end));
        i = end - 1;
      } else {
        await this.runTest(child);
      }
    }
    if (runnable) {
      try {
        await this.runHooks(this.afterHooks(suite.hooks.afterAll));
      } catch (error) {
        this.file.errors.push(serializeError(error));
      }
    }
  }
}

module.exports = { FileRunner };
