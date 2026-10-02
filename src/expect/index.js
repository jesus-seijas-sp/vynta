const state = require('../state');
const { waitFor } = require('../wait');
const { createAssertion, defineMatchers, hasMatcher } = require('./assertion');
const { AssertionError } = require('./assertion-error');
const { asymmetric, CustomMatcher } = require('./asymmetric');
const { getContext } = require('./context');
const { addEqualityTesters } = require('./equals');
const { matchers } = require('./matchers');
const snapshotMatchers = require('../snapshot/matchers');
const { addSnapshotSerializer } = require('../snapshot/serializers');

defineMatchers({ ...matchers, ...snapshotMatchers });

function expect(actual, message) {
  return createAssertion(actual, message);
}

Object.assign(expect, asymmetric, { not: { ...asymmetric.not } });

expect.extend = (newMatchers) => {
  defineMatchers(newMatchers);
  Object.entries(newMatchers).forEach(([name, matcher]) => {
    expect[name] = (...args) => new CustomMatcher(name, matcher, args, false, getContext(false));
    expect.not[name] = (...args) => new CustomMatcher(name, matcher, args, true, getContext(true));
  });
};

expect.soft = (actual, message) => createAssertion(actual, message, true);

// Chai's, which vitest's expect carries: fails the test with the message given.
expect.fail = (message = 'expect.fail()') => {
  throw new AssertionError(message);
};

expect.assertions = (count) => {
  if (state.test) {
    state.test.expectedAssertions = count;
  }
};

expect.hasAssertions = () => {
  if (state.test) {
    state.test.hasAssertions = true;
  }
};

function snapshotMode() {
  if (state.config.update) {
    return 'all';
  }
  return (state.config.ci ?? Boolean(process.env.CI)) ? 'none' : 'new';
}

expect.getState = () => ({
  assertionCalls: state.file?.assertionCalls ?? 0,
  currentTestName: state.test?.fullName,
  testPath: state.file?.path,
  expectedAssertionsNumber: state.test?.expectedAssertions ?? null,
  isExpectingAssertions: Boolean(state.test?.hasAssertions),
  // What Jest's SnapshotState does with snapshots: write them all (-u), never (CI) or only the new ones. Tests read
  // its _updateSnapshot to decide whether to regenerate fixtures.
  snapshotState: { _updateSnapshot: snapshotMode() },
});

expect.setState = ({ expectedAssertionsNumber } = {}) => {
  if (state.test && expectedAssertionsNumber !== undefined) {
    state.test.expectedAssertions = expectedAssertionsNumber;
  }
};

expect.addEqualityTesters = addEqualityTesters;

expect.unreachable = (message) => {
  throw new AssertionError(`expected ${message ? `"${message}" ` : ''}not to be reached`);
};

// expect.poll(fn).toBe(x): retries the assertion on fn() until it passes or the timeout ends.
expect.poll = (fn, options = {}) => {
  const poller = (isNot) =>
    new Proxy(
      {},
      {
        get(target, name) {
          if (name === 'not') {
            return poller(!isNot);
          }
          if (typeof name !== 'string' || !hasMatcher(name)) {
            return undefined;
          }
          const assertion = async () => {
            const created = createAssertion(await fn());
            return isNot ? created.not : created;
          };
          return (...args) => waitFor(async () => (await assertion())[name](...args), options);
        },
      }
    );
  return poller(false);
};

expect.addSnapshotSerializer = addSnapshotSerializer;

module.exports = { expect, AssertionError };
