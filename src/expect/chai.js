const state = require('../state');
const { AssertionError } = require('./assertion-error');
const { equals, subsetEquals } = require('./equals');
const { stringify } = require('./format');

const show = (value) => stringify(value, 200);

const typeOf = (value) => {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  const tag = Object.prototype.toString.call(value).slice(8, -1).toLowerCase();
  return typeof value === 'object' ? tag : typeof value;
};

const sizeOf = (value) => (value instanceof Map || value instanceof Set ? value.size : value?.length);

function includes(actual, expected, deep) {
  if (typeof actual === 'string') {
    return actual.includes(expected);
  }
  if (actual instanceof Set) {
    return deep ? [...actual].some((item) => equals(item, expected)) : actual.has(expected);
  }
  if (actual instanceof Map) {
    return [...actual.values()].some((item) => (deep ? equals(item, expected) : item === expected));
  }
  if (Array.isArray(actual)) {
    return deep ? actual.some((item) => equals(item, expected)) : actual.includes(expected);
  }
  if (actual !== null && typeof actual === 'object' && expected !== null && typeof expected === 'object') {
    return deep ? subsetEquals(actual, expected) : Object.keys(expected).every((key) => actual[key] === expected[key]);
  }
  return false;
}

// Chai's BDD assertions, which vitest's expect carries next to Jest's matchers: expect(x).to.be.true,
// expect(a).to.deep.equal(b), expect(list).to.include(item)... The words that only read well (to, be, have...)
// return the assertion itself; `not` and `deep` change how the next assertion checks.
class ChaiAssertion {
  #actual;

  #negate;

  #deep = false;

  constructor(actual, negate = false) {
    this.#actual = actual;
    this.#negate = negate;
  }

  #assert(pass, message, negatedMessage, expected) {
    if (state.file) {
      state.file.assertionCalls += 1;
    }
    if (state.test) {
      state.test.assertions += 1;
    }
    if (pass === this.#negate) {
      throw new AssertionError(this.#negate ? negatedMessage : message, { actual: this.#actual, expected });
    }
    return this;
  }

  #describe(text) {
    return `expected ${show(this.#actual)} ${text}`;
  }

  #check(pass, text, expected) {
    return this.#assert(pass, this.#describe(`to ${text}`), this.#describe(`not to ${text}`), expected);
  }

  get to() {
    return this;
  }

  get be() {
    return this;
  }

  get been() {
    return this;
  }

  get is() {
    return this;
  }

  get that() {
    return this;
  }

  get which() {
    return this;
  }

  get and() {
    return this;
  }

  get has() {
    return this;
  }

  get have() {
    return this;
  }

  get with() {
    return this;
  }

  get at() {
    return this;
  }

  get of() {
    return this;
  }

  get same() {
    return this;
  }

  get but() {
    return this;
  }

  get does() {
    return this;
  }

  get still() {
    return this;
  }

  get also() {
    return this;
  }

  get not() {
    this.#negate = !this.#negate;
    return this;
  }

  get deep() {
    this.#deep = true;
    return this;
  }

  get true() {
    return this.#check(this.#actual === true, 'be true');
  }

  get false() {
    return this.#check(this.#actual === false, 'be false');
  }

  get null() {
    return this.#check(this.#actual === null, 'be null');
  }

  get undefined() {
    return this.#check(this.#actual === undefined, 'be undefined');
  }

  get NaN() {
    return this.#check(Number.isNaN(this.#actual), 'be NaN');
  }

  get ok() {
    return this.#check(Boolean(this.#actual), 'be truthy');
  }

  get exist() {
    return this.#check(this.#actual !== null && this.#actual !== undefined, 'exist');
  }

  get empty() {
    const actual = this.#actual;
    const size = typeof actual === 'object' && actual !== null && sizeOf(actual) === undefined;
    return this.#check(size ? Object.keys(actual).length === 0 : sizeOf(actual) === 0, 'be empty');
  }

  get called() {
    return this.#check(this.#calls().length > 0, 'have been called');
  }

  get calledOnce() {
    return this.#check(this.#calls().length === 1, 'have been called once');
  }

  #calls() {
    const calls = this.#actual?.mock?.calls;
    if (!calls) {
      throw new TypeError(`${show(this.#actual)} is not a spy or a call to a spy`);
    }
    return calls;
  }

  callCount(count) {
    return this.#check(this.#calls().length === count, `have been called ${count} times`, count);
  }

  calledTimes(count) {
    return this.callCount(count);
  }

  calledWith(...args) {
    return this.#check(
      this.#calls().some((call) => equals(call, args)),
      `have been called with ${show(args)}`,
      args
    );
  }

  equal(expected) {
    const pass = this.#deep ? equals(this.#actual, expected) : this.#actual === expected;
    return this.#check(pass, `${this.#deep ? 'deeply ' : ''}equal ${show(expected)}`, expected);
  }

  equals(expected) {
    return this.equal(expected);
  }

  eq(expected) {
    return this.equal(expected);
  }

  eql(expected) {
    return this.#check(equals(this.#actual, expected), `deeply equal ${show(expected)}`, expected);
  }

  eqls(expected) {
    return this.eql(expected);
  }

  include(expected) {
    return this.#check(includes(this.#actual, expected, this.#deep), `include ${show(expected)}`, expected);
  }

  includes(expected) {
    return this.include(expected);
  }

  contain(expected) {
    return this.include(expected);
  }

  contains(expected) {
    return this.include(expected);
  }

  a(type) {
    return this.#check(typeOf(this.#actual) === String(type).toLowerCase(), `be a ${type}`, type);
  }

  an(type) {
    return this.a(type);
  }

  instanceOf(constructor) {
    return this.#check(this.#actual instanceof constructor, `be an instance of ${constructor?.name}`, constructor);
  }

  instanceof(constructor) {
    return this.instanceOf(constructor);
  }

  lengthOf(length) {
    return this.#check(sizeOf(this.#actual) === length, `have a length of ${length}`, length);
  }

  length(length) {
    return this.lengthOf(length);
  }

  property(name, ...value) {
    const has = this.#actual !== null && this.#actual !== undefined && name in Object(this.#actual);
    if (value.length === 0) {
      return this.#check(has, `have property ${show(name)}`);
    }
    const actual = has ? this.#actual[name] : undefined;
    const same = this.#deep ? equals(actual, value[0]) : actual === value[0];
    return this.#check(has && same, `have property ${show(name)} of ${show(value[0])}`, value[0]);
  }

  above(value) {
    return this.#check(this.#actual > value, `be above ${value}`, value);
  }

  gt(value) {
    return this.above(value);
  }

  greaterThan(value) {
    return this.above(value);
  }

  least(value) {
    return this.#check(this.#actual >= value, `be at least ${value}`, value);
  }

  gte(value) {
    return this.least(value);
  }

  below(value) {
    return this.#check(this.#actual < value, `be below ${value}`, value);
  }

  lt(value) {
    return this.below(value);
  }

  lessThan(value) {
    return this.below(value);
  }

  most(value) {
    return this.#check(this.#actual <= value, `be at most ${value}`, value);
  }

  lte(value) {
    return this.most(value);
  }

  within(low, high) {
    return this.#check(this.#actual >= low && this.#actual <= high, `be within ${low}..${high}`);
  }

  closeTo(expected, delta) {
    return this.#check(Math.abs(this.#actual - expected) <= delta, `be close to ${expected} +/- ${delta}`, expected);
  }

  match(pattern) {
    return this.#check(pattern.test(this.#actual), `match ${pattern}`, pattern);
  }

  oneOf(list) {
    return this.#check(
      list.some((item) => (this.#deep ? equals(item, this.#actual) : item === this.#actual)),
      `be one of ${show(list)}`,
      list
    );
  }

  keys(...names) {
    const wanted = names.length === 1 && Array.isArray(names[0]) ? names[0] : names;
    const actual = Object.keys(Object(this.#actual));
    const pass = wanted.length === actual.length && wanted.every((name) => actual.includes(name));
    return this.#check(pass, `have keys ${show(wanted)}`, wanted);
  }

  members(list) {
    const actual = [...this.#actual];
    const has = (item) => actual.some((value) => (this.#deep ? equals(value, item) : value === item));
    return this.#check(actual.length === list.length && list.every(has), `have members ${show(list)}`, list);
  }

  throw(expected, message) {
    let thrown;
    let threw = false;
    try {
      this.#actual();
    } catch (error) {
      threw = true;
      thrown = error;
    }
    const matches = (value) => {
      if (value === undefined) {
        return true;
      }
      if (typeof value === 'string') {
        return String(thrown?.message ?? thrown).includes(value);
      }
      if (value instanceof RegExp) {
        return value.test(String(thrown?.message ?? thrown));
      }
      if (typeof value === 'function') {
        return thrown instanceof value;
      }
      return thrown === value;
    };
    const pass = threw && matches(expected) && matches(message);
    return this.#check(pass, `throw${expected === undefined ? '' : ` ${show(expected)}`}`, expected);
  }

  throws(expected, message) {
    return this.throw(expected, message);
  }

  Throw(expected, message) {
    return this.throw(expected, message);
  }
}

module.exports = { ChaiAssertion };
