const { colors: c } = require('../colors');
const state = require('../state');
const { equals, customTesters } = require('./equals');
const { format, stringify } = require('./format');
const { diff } = require('./diff');

const EXPECTED_COLOR = (s) => c.green(s);
const RECEIVED_COLOR = (s) => c.red(s);

// expect(received).not.toBe(expected) // comment
function matcherHint(name, received = 'received', expected = 'expected', options = {}) {
  const { isNot = false, promise = '', secondArgument = '', comment = '' } = options;
  const parts = [c.dim('expect('), RECEIVED_COLOR(received), c.dim(')')];
  if (promise) {
    parts.push(c.dim(`.${promise}`));
  }
  if (isNot) {
    parts.push(c.dim('.not'));
  }
  parts.push(c.dim(`.${name}(`));
  if (expected) {
    parts.push(EXPECTED_COLOR(expected));
  }
  if (secondArgument) {
    parts.push(c.dim(', '), EXPECTED_COLOR(secondArgument));
  }
  parts.push(c.dim(')'));
  if (comment) {
    parts.push(c.dim(` // ${comment}`));
  }
  return parts.join('');
}

const printReceived = (value) => RECEIVED_COLOR(stringify(value));
const printExpected = (value) => EXPECTED_COLOR(stringify(value));

function printWithType(name, value, print) {
  const type = value === null ? 'null' : typeof value;
  const typeLine = type !== 'null' && type !== 'undefined' ? `${name} has type:  ${type}\n` : '';
  return `${typeLine}${name} has value: ${print(value)}`;
}

function printDiffOrStringify(expected, received, expectedLabel = 'Expected', receivedLabel = 'Received') {
  const changes = diff(expected, received, equals);
  if (changes) {
    return changes;
  }
  const width = Math.max(expectedLabel.length, receivedLabel.length) + 2;
  return [
    `${`${expectedLabel}:`.padEnd(width)}${printExpected(expected)}`,
    `${`${receivedLabel}:`.padEnd(width)}${printReceived(received)}`,
  ].join('\n');
}

// The error thrown when a matcher is used wrongly (as opposed to an assertion that fails).
function matcherError(hint, generic, specific) {
  return new Error(`${hint}\n\n${c.bold('Matcher error')}: ${generic}${specific ? `\n\n${specific}` : ''}`);
}

const isNumeric = (value) => typeof value === 'number' || typeof value === 'bigint';

function ensureNumbers(actual, expected, name) {
  if (!isNumeric(actual)) {
    throw matcherError(
      matcherHint(name),
      `${RECEIVED_COLOR('received')} value must be a number or bigint`,
      printWithType('Received', actual, printReceived)
    );
  }
  if (!isNumeric(expected)) {
    throw matcherError(
      matcherHint(name),
      `${EXPECTED_COLOR('expected')} value must be a number or bigint`,
      printWithType('Expected', expected, printExpected)
    );
  }
}

// What Jest gives custom matchers as this.utils.
const utils = {
  EXPECTED_COLOR,
  RECEIVED_COLOR,
  INVERTED_COLOR: (s) => c.inverse(s),
  BOLD_WEIGHT: (s) => c.bold(s),
  DIM_COLOR: (s) => c.dim(s),
  matcherHint,
  matcherErrorMessage: (hint, generic, specific) => matcherError(hint, generic, specific).message,
  printReceived,
  printExpected,
  printWithType,
  printDiffOrStringify,
  diff: (a, b) => diff(a, b, equals),
  stringify,
  format,
  ensureNumbers,
  ensureActualIsNumber: (actual, name) => ensureNumbers(actual, 0, name),
  ensureExpectedIsNumber: (expected, name) => ensureNumbers(0, expected, name),
  ensureNoExpected: (expected, name) => {
    if (expected !== undefined) {
      throw matcherError(matcherHint(name, undefined, ''), 'this matcher must not have an expected argument');
    }
  },
  pluralize: (word, count) => `${count} ${word}${count === 1 ? '' : 's'}`,
};

// The `this` of matchers. One is shared by every assertion with the same .not / .resolves / .rejects flags.
class MatcherContext {
  constructor(isNot, promise) {
    this.isNot = isNot;
    this.promise = promise;
    this.equals = equals;
    this.utils = utils;
    this.customTesters = customTesters;
    this.expand = false;
  }

  // Getters rather than fields, as they change with the running test.
  // eslint-disable-next-line class-methods-use-this
  get currentTestName() {
    return state.test?.fullName;
  }

  // eslint-disable-next-line class-methods-use-this
  get testPath() {
    return state.file?.path;
  }

  // eslint-disable-next-line class-methods-use-this
  get assertionCalls() {
    return state.file?.assertionCalls ?? 0;
  }

  // Jest API, kept for matchers that call it.
  // eslint-disable-next-line class-methods-use-this
  dontThrow() {}

  // The hint for the assertion this context belongs to.
  hint(name, expected = 'expected', options = {}) {
    return matcherHint(name, 'received', expected, { isNot: this.isNot, promise: this.promise, ...options });
  }

  // "Expected: not ..." with the padding of the other lines when negated.
  not(text) {
    return this.isNot ? `${text} not` : text;
  }
}

const contexts = new Map();

function getContext(isNot = false, promise = '') {
  const key = `${isNot}:${promise}`;
  if (!contexts.has(key)) {
    contexts.set(key, new MatcherContext(isNot, promise));
  }
  return contexts.get(key);
}

module.exports = {
  getContext,
  utils,
  matcherHint,
  matcherError,
  printReceived,
  printExpected,
  printDiffOrStringify,
  printWithType,
  ensureNumbers,
  EXPECTED_COLOR,
  RECEIVED_COLOR,
};
