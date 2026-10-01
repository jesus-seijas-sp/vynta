// An it() / test().
class TestCase {
  constructor(name, fn, parent, mode, options = {}, flags = {}) {
    this.type = 'test';
    this.name = name;
    this.fn = fn;
    this.parent = parent;
    this.mode = mode;
    this.timeout = options.timeout;
    this.retry = options.retry;
    this.repeats = options.repeats ?? 0;
    this.fails = Boolean(flags.fails || options.fails);
    this.concurrent = flags.sequential ? false : Boolean(flags.concurrent || options.concurrent || parent.concurrent);
    this.fullName = parent.fullName ? `${parent.fullName} ${name}` : name;
    this.fixtures = flags.fixtures;
    // Set when a beforeAll of its suites failed.
    this.failError = null;
  }

  // State of one run of the test, set before every attempt (not at collection: most tests are never retried and
  // skipped ones never run).
  reset() {
    this.assertions = 0;
    this.expectedAssertions = undefined;
    this.hasAssertions = false;
    this.softErrors = [];
    this.pendingAssertions = [];
    this.onFinished = [];
    this.onFailed = [];
    this.abort = new AbortController();
    // Snapshot name -> calls so far, for the numbers of the snapshot keys.
    this.snapshotCounts = new Map();
  }

  // Names from the outermost describe to the test.
  get titlePath() {
    const names = [this.name];
    for (let suite = this.parent; suite?.parent; suite = suite.parent) {
      names.unshift(suite.name);
    }
    return names;
  }
}

module.exports = { TestCase };
