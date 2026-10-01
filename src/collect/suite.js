// A describe() block, or the root of a file. mode is 'run', 'only', 'skip' or 'todo'.
class Suite {
  constructor(name = '', parent = null, mode = 'run', options = {}) {
    this.type = 'suite';
    this.name = name;
    this.parent = parent;
    this.mode = mode;
    this.options = options;
    this.children = [];
    this.hooks = { beforeAll: [], afterAll: [], beforeEach: [], afterEach: [] };
    this.concurrent = options.concurrent ?? parent?.concurrent ?? false;
    this.fullName = parent?.fullName ? `${parent.fullName} ${name}` : name;
    this.collectError = null;
  }

  // Suites from the root down to this one.
  get path() {
    const suites = [];
    for (let suite = this; suite; suite = suite.parent) {
      suites.unshift(suite);
    }
    return suites;
  }

  hasOnly() {
    return this.children.some((child) => child.mode === 'only' || (child.type === 'suite' && child.hasOnly()));
  }

  hasRunnable() {
    return this.children.some((child) => (child.type === 'test' ? child.mode === 'run' : child.hasRunnable()));
  }

  // Keeps only the tests keep() accepts, and the suites that still have tests: what a shard of a split file runs.
  retainTests(keep) {
    this.children = this.children.filter((child) => {
      if (child.type === 'test') {
        return keep(child);
      }
      child.retainTests(keep);
      return child.children.length > 0;
    });
  }

  // Marks every test that would run as skipped (a skipped or todo describe).
  skipAll() {
    this.children.forEach((child) => {
      if (child.mode === 'run' || child.mode === 'only') {
        child.mode = 'skip';
      }
      if (child.type === 'suite') {
        child.skipAll();
      }
    });
  }

  // A failing beforeAll fails every test that would run.
  failAll(error) {
    this.children.forEach((child) => {
      if (child.type === 'suite') {
        child.failAll(error);
      } else if (child.mode === 'run') {
        child.failError = error;
      }
    });
  }

  // Applies .only and the test name pattern: what is left out is marked as skipped. Mirrors vitest's rules.
  interpretModes(hasOnly, pattern, parentIsOnly = false) {
    const isOnly = parentIsOnly || this.mode === 'only';
    this.children.forEach((child) => {
      const included = isOnly || child.mode === 'only';
      if (hasOnly && !(child.type === 'suite' && (included || child.hasOnly())) && child.mode === 'run' && !included) {
        child.mode = 'skip';
      }
      if (child.mode === 'only') {
        child.mode = 'run';
      }
      if (child.type === 'test') {
        if (pattern && child.mode === 'run' && !pattern.test(child.fullName)) {
          child.mode = 'skip';
        }
      } else if (child.mode === 'skip' || child.mode === 'todo') {
        child.skipAll();
      } else {
        child.interpretModes(hasOnly, pattern, included && hasOnly);
      }
    });
  }
}

module.exports = { Suite };
