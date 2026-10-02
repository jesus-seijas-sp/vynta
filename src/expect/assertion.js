const { colors: c } = require('../colors');
const state = require('../state');
const { AssertionError } = require('./assertion-error');
const { ChaiAssertion } = require('./chai');
const { getContext, matcherHint, printReceived } = require('./context');

const isThenable = (value) => typeof value?.then === 'function';

// Assertions that end later (.resolves, .rejects, async matchers) are tracked, so a test that forgets to await them
// still fails. What the test gets is a thenable that notes when it is awaited: a failure of an awaited assertion
// reaches the test through the await, and must not be reported a second time.
function track(promise) {
  const entry = { promise, handled: false };
  // Its failure is reported through the test, not as an unhandled rejection.
  promise.catch(() => {});
  state.test?.pendingAssertions.push(entry);
  const handle = (method, args) => {
    entry.handled = true;
    return promise[method](...args);
  };
  return {
    then: (...args) => handle('then', args),
    catch: (...args) => handle('catch', args),
    finally: (...args) => handle('finally', args),
    [Symbol.toStringTag]: 'Promise',
  };
}

// A failed assertion is thrown, or kept when it is an expect.soft().
function report(assertion, error) {
  if (assertion.soft && state.test) {
    state.test.softErrors.push(error);
    return;
  }
  throw error;
}

// stackSource is where the assertion was written, for the ones that end asynchronously; otherwise the stack starts
// at the caller of `caller`.
function fail(assertion, result, caller, stackSource) {
  let message =
    (typeof result.message === 'function' ? result.message() : result.message) ??
    'No message was specified for this matcher.';
  if (assertion.message) {
    message = `${assertion.message}\n\n${message}`;
  }
  const error = new AssertionError(message, result);
  if (stackSource) {
    error.withStackOf(stackSource);
  } else {
    Error.captureStackTrace(error, caller);
  }
  report(assertion, error);
}

function check(assertion, result, caller, stackSource) {
  if (typeof result?.pass !== 'boolean') {
    throw new Error(
      `Unexpected return from a matcher function.\nMatcher functions should return an object in the following format:\n  {message?: string | function, pass: boolean}\n'${JSON.stringify(result)}' was returned`
    );
  }
  if (result.pass === assertion.isNot) {
    fail(assertion, result, caller, stackSource);
  }
}

function wrongSettlement(assertion, name, value, settled, stackSource) {
  const { isNot, promise } = assertion;
  const expected = promise === 'rejects' ? 'rejected' : 'resolved';
  const label = settled === 'rejected' ? 'Rejected to' : 'Resolved to';
  const error = new AssertionError(
    `${matcherHint(name, 'received', '', { isNot, promise })}\n\nReceived promise ${settled} instead of ${expected}\n${label} value: ${printReceived(value)}`
  );
  report(assertion, error.withStackOf(stackSource));
}

function runPromise(assertion, name, matcher, args, caller) {
  const { isNot, promise } = assertion;
  const stackSource = new Error();
  Error.captureStackTrace(stackSource, caller);
  const actual = typeof assertion.actual === 'function' ? assertion.actual() : assertion.actual;
  if (!isThenable(actual)) {
    const error = new AssertionError(
      `${matcherHint(name, 'received', '', { isNot, promise })}\n\n${c.bold('Matcher error')}: ${c.red('received')} value must be a promise or a function returning a promise\n\nReceived: ${printReceived(actual)}`
    );
    return Promise.reject(error.withStackOf(stackSource));
  }
  const context = getContext(isNot, promise);
  const apply = async (value) => check(assertion, await matcher.call(context, value, ...args), caller, stackSource);
  const wanted = promise === 'resolves';
  return track(
    actual.then(
      (value) => (wanted ? apply(value) : wrongSettlement(assertion, name, value, 'resolved', stackSource)),
      (reason) => (wanted ? wrongSettlement(assertion, name, reason, 'rejected', stackSource) : apply(reason))
    )
  );
}

function countAssertion() {
  if (state.file) {
    state.file.assertionCalls += 1;
  }
  if (state.test) {
    state.test.assertions += 1;
  }
}

// name -> the method every assertion object has for that matcher.
const methods = new Map();

function createMethod(name, matcher) {
  // A named function expression, so failures can cut the stack at it.
  const method = function assertionMatcher(...args) {
    countAssertion();
    if (this.promise) {
      return runPromise(this, name, matcher, args, method);
    }
    const result = matcher.call(getContext(this.isNot), this.actual, ...args);
    if (isThenable(result)) {
      const stackSource = new Error();
      Error.captureStackTrace(stackSource, method);
      return track(result.then((value) => check(this, value, method, stackSource)));
    }
    if (result.pass === this.isNot) {
      fail(this, result, method);
    }
    return undefined;
  };
  Object.defineProperty(method, 'name', { value: name });
  return method;
}

// What expect(value) returns has the shape of Jest's: every matcher, and .not, .resolves, .rejects (and their .not),
// are own properties, as libraries that wrap expect copy them (Object.assign, spread). The objects are object
// literals made by a function generated from the matcher names: V8 builds them as fast as a class instance, while
// adding 50 properties one by one would take 300 times longer.
let createAssertion;

// Chai's assertions (vitest's expect is chai's): expect(x).to.be.true, expect(list).includes(item). Matchers of the
// same name, added with expect.extend, come after and win.
const CHAI = [
  'get to() { return new C(this.actual, this.isNot); }',
  'include(value) { return new C(this.actual, this.isNot).include(value); }',
  'includes(value) { return new C(this.actual, this.isNot).include(value); }',
].join(', ');

function compile() {
  const names = [...methods.keys()];
  const fields = names.map((name, i) => `${JSON.stringify(name)}: M[${i}]`).join(', ');
  // eslint-disable-next-line no-new-func -- the fastest way to build objects with these properties, see above
  const factory = new Function(
    'M',
    'C',
    `const one = (actual, isNot, promise, message, soft) => ({ actual, isNot, promise, message, soft, not: undefined, ${CHAI}, ${fields} });
    return (actual, message, soft) => {
      const assertion = one(actual, false, '', message, soft);
      assertion.not = one(actual, true, '', message, soft);
      const resolves = one(actual, false, 'resolves', message, soft);
      resolves.not = one(actual, true, 'resolves', message, soft);
      const rejects = one(actual, false, 'rejects', message, soft);
      rejects.not = one(actual, true, 'rejects', message, soft);
      assertion.resolves = resolves;
      assertion.rejects = rejects;
      return assertion;
    };`
  );
  createAssertion = factory([...methods.values()], ChaiAssertion);
}

function defineMatchers(matchers) {
  Object.entries(matchers).forEach(([name, matcher]) => methods.set(name, createMethod(name, matcher)));
  compile();
}

const create = (actual, message = undefined, soft = false) => createAssertion(actual, message, soft);

const hasMatcher = (name) => methods.has(name);

module.exports = { createAssertion: create, defineMatchers, hasMatcher };
