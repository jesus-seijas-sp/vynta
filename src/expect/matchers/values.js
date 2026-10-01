const { colors: c } = require('../../colors');
const { equals } = require('../equals');
const { printReceived, printExpected, printWithType, matcherError } = require('../context');

// Matchers that only look at the received value: toBeNull(), toBeTruthy()...
function valueMatcher(name, test) {
  return function matcher(received, expected) {
    if (expected !== undefined) {
      throw matcherError(this.hint(name, ''), 'this matcher must not have an expected argument');
    }
    return {
      pass: test(received),
      message: () => `${this.hint(name, '')}\n\nReceived: ${printReceived(received)}`,
    };
  };
}

const constructorName = (value) => (value === null || value === undefined ? undefined : value.constructor?.name);

function toBeInstanceOf(received, expected) {
  if (typeof expected !== 'function') {
    throw matcherError(
      this.hint('toBeInstanceOf'),
      `${c.green('expected')} value must be a function`,
      printWithType('Expected', expected, printExpected)
    );
  }
  return {
    pass: received instanceof expected,
    message: () => {
      const got = constructorName(received);
      const gotLine = got ? `Received constructor: ${c.red(got)}\n` : '';
      const label = this.isNot ? 'Expected constructor: not' : 'Expected constructor:';
      return `${this.hint('toBeInstanceOf')}\n\n${label} ${c.green(expected.name || String(expected))}\n${gotLine}Received value: ${printReceived(received)}`;
    },
  };
}

function toBeTypeOf(received, expected) {
  return {
    // eslint-disable-next-line valid-typeof -- the type name is the matcher's argument
    pass: typeof received === expected,
    message: () =>
      `${this.hint('toBeTypeOf')}\n\n${this.not('Expected:')} ${printExpected(expected)}\nReceived: ${printReceived(typeof received)}`,
  };
}

function toBeOneOf(received, expected) {
  return {
    pass: Array.isArray(expected) && expected.some((item) => equals(received, item)),
    message: () =>
      `${this.hint('toBeOneOf')}\n\n${this.not('Expected')} one of: ${printExpected(expected)}\nReceived: ${printReceived(received)}`,
  };
}

function toSatisfy(received, predicate, text) {
  return {
    pass: Boolean(predicate(received)),
    message: () =>
      `${this.hint('toSatisfy', 'predicate')}\n\n${text ? `${text}\n` : ''}Received: ${printReceived(received)}`,
  };
}

module.exports = {
  toBeDefined: valueMatcher('toBeDefined', (value) => value !== undefined),
  toBeUndefined: valueMatcher('toBeUndefined', (value) => value === undefined),
  toBeNull: valueMatcher('toBeNull', (value) => value === null),
  toBeTruthy: valueMatcher('toBeTruthy', Boolean),
  toBeFalsy: valueMatcher('toBeFalsy', (value) => !value),
  toBeNaN: valueMatcher('toBeNaN', Number.isNaN),
  toBeInstanceOf,
  toBeTypeOf,
  toBeOneOf,
  toSatisfy,
};
