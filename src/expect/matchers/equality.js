const { colors: c } = require('../../colors');
const { equals, subsetEquals } = require('../equals');
const { stringify } = require('../format');
const { printReceived, printExpected, printDiffOrStringify, printWithType, matcherError } = require('../context');

const isObject = (value) => typeof value === 'object' && value !== null;

// When toBe fails on values that are deeply equal, suggest the matcher they should have used.
function toBeSuggestion(received, expected) {
  if (equals(received, expected, [], true)) {
    return 'toStrictEqual';
  }
  return equals(received, expected) ? 'toEqual' : '';
}

function toBe(received, expected) {
  return {
    pass: Object.is(received, expected),
    message: () => {
      const hint = this.hint('toBe', 'expected', { comment: 'Object.is equality' });
      if (this.isNot) {
        return `${hint}\n\nExpected: not ${printExpected(expected)}`;
      }
      const suggestion = toBeSuggestion(received, expected);
      const note = suggestion
        ? `\n\n${c.bold(`If it should pass with deep equality, replace "toBe" with "${suggestion}"`)}`
        : '';
      const details =
        isObject(received) && isObject(expected) && !suggestion
          ? printDiffOrStringify(expected, received)
          : `Expected: ${printExpected(expected)}\nReceived: ${printReceived(received)}`;
      return `${hint}${note}\n\n${details}`;
    },
  };
}

function notEqualMessage(ctx, name, received, expected) {
  const receivedLine = stringify(expected) === stringify(received) ? '' : `\nReceived:     ${printReceived(received)}`;
  return `${ctx.hint(name)}\n\nExpected: not ${printExpected(expected)}${receivedLine}`;
}

function toEqual(received, expected) {
  return {
    pass: equals(received, expected),
    message: () =>
      this.isNot
        ? notEqualMessage(this, 'toEqual', received, expected)
        : `${this.hint('toEqual')}\n\n${printDiffOrStringify(expected, received)}`,
  };
}

function toStrictEqual(received, expected) {
  return {
    pass: equals(received, expected, [], true),
    message: () =>
      this.isNot
        ? notEqualMessage(this, 'toStrictEqual', received, expected)
        : `${this.hint('toStrictEqual')}\n\n${printDiffOrStringify(expected, received)}`,
  };
}

// For the toMatchObject diff: only the part of received that expected talks about.
function pickSubset(received, expected, seen = new WeakSet()) {
  if (!isObject(received) || !isObject(expected) || seen.has(received)) {
    return received;
  }
  seen.add(received);
  if (Array.isArray(received) && Array.isArray(expected)) {
    return received.map((item, i) => (i < expected.length ? pickSubset(item, expected[i], seen) : item));
  }
  if (Array.isArray(received) || received instanceof Date || received instanceof RegExp) {
    return received;
  }
  const result = Object.create(Object.getPrototypeOf(received));
  Object.keys(expected)
    .filter((key) => key in received)
    .forEach((key) => {
      result[key] = pickSubset(received[key], expected[key], seen);
    });
  return result;
}

function toMatchObject(received, expected) {
  if (!isObject(received)) {
    throw matcherError(
      this.hint('toMatchObject'),
      `${c.red('received')} value must be a non-null object`,
      printWithType('Received', received, printReceived)
    );
  }
  if (!isObject(expected)) {
    throw matcherError(
      this.hint('toMatchObject'),
      `${c.green('expected')} value must be a non-null object`,
      printWithType('Expected', expected, printExpected)
    );
  }
  return {
    pass: subsetEquals(received, expected),
    message: () =>
      this.isNot
        ? `${this.hint('toMatchObject')}\n\nExpected: not ${printExpected(expected)}`
        : `${this.hint('toMatchObject')}\n\n${printDiffOrStringify(expected, pickSubset(received, expected))}`,
  };
}

module.exports = { toBe, toEqual, toStrictEqual, toMatchObject };
