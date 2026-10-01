// vitest's test.extend() fixtures. A fixture is a value, or an async function (context, use) that sets something
// up, hands it to the test with `await use(value)` and tears it down when use() returns. Only the fixtures a test
// destructures are set up (plus the auto ones), each after the fixtures it destructures itself.

// Names destructured by the first parameter, or null when they can not be known (no destructuring, or ...rest).
function destructuredNames(fn) {
  const match = /^(?:async\s*)?(?:function\b[^(]*)?\(\s*\{([^}]*)\}/.exec(Function.prototype.toString.call(fn));
  if (!match || match[1].includes('...')) {
    return null;
  }
  return match[1]
    .split(',')
    .map((part) => part.split(/[:=]/)[0].trim())
    .filter(Boolean);
}

// [value, { auto: true }] is a fixture with options.
function parseFixture(definition) {
  const withOptions =
    Array.isArray(definition) &&
    definition.length === 2 &&
    typeof definition[1] === 'object' &&
    definition[1] !== null &&
    !Array.isArray(definition[1]);
  return withOptions ? { value: definition[0], options: definition[1] } : { value: definition, options: {} };
}

class FixtureSet {
  constructor(fixtures, context) {
    this.fixtures = fixtures;
    this.context = context;
    this.ready = new Set();
    this.pending = new Set();
    this.teardowns = [];
  }

  async init(key) {
    if (this.ready.has(key) || !Object.hasOwn(this.fixtures, key)) {
      return;
    }
    if (this.pending.has(key)) {
      throw new Error(`Circular fixture dependency: ${key}`);
    }
    this.pending.add(key);
    const { value } = parseFixture(this.fixtures[key]);
    if (typeof value === 'function') {
      const deps = destructuredNames(value) ?? Object.keys(this.fixtures);
      await deps.filter((dep) => dep !== key).reduce((prev, dep) => prev.then(() => this.init(dep)), Promise.resolve());
      this.context[key] = await this.run(value);
    } else {
      this.context[key] = value;
    }
    this.pending.delete(key);
    this.ready.add(key);
  }

  // Runs a fixture function until it calls use(), and keeps the rest of it as the teardown.
  async run(setup) {
    const provided = Promise.withResolvers();
    const released = Promise.withResolvers();
    const running = Promise.resolve(
      setup(this.context, async (value) => {
        provided.resolve({ value });
        await released.promise;
      })
    );
    const first = await Promise.race([provided.promise, running.then(() => null)]);
    this.teardowns.push(async () => {
      released.resolve();
      await running;
    });
    return first?.value;
  }

  async setup(testFn) {
    const autos = Object.keys(this.fixtures).filter((key) => parseFixture(this.fixtures[key]).options.auto);
    const used = destructuredNames(testFn) ?? Object.keys(this.fixtures);
    await [...autos, ...used].reduce((prev, key) => prev.then(() => this.init(key)), Promise.resolve());
  }

  // Teardowns run in reverse order; returns the errors they throw.
  async teardown() {
    const errors = [];
    await this.teardowns.reduceRight(
      (prev, teardown) => prev.then(() => teardown().catch((error) => errors.push(error))),
      Promise.resolve()
    );
    return errors;
  }
}

module.exports = { FixtureSet };
