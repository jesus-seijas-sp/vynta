const { colors: c } = require('../../colors');
const { equals } = require('../equals');
const { printReceived, printExpected, printDiffOrStringify, printWithType, matcherError } = require('../context');

function receivedError(ctx, name, requirement, received, expected = 'expected') {
  return matcherError(
    ctx.hint(name, expected),
    `${c.red('received')} value ${requirement}`,
    printWithType('Received', received, printReceived)
  );
}

function containsValue(received, expected) {
  if (typeof received === 'string') {
    return received.includes(String(expected));
  }
  if (Array.isArray(received)) {
    return received.includes(expected);
  }
  if (typeof received[Symbol.iterator] === 'function') {
    return [...received].includes(expected);
  }
  // DOM token lists and the like.
  return received.contains(expected);
}

function toContain(received, expected) {
  if (received === null || received === undefined) {
    throw receivedError(this, 'toContain', 'must not be null nor undefined', received);
  }
  if (
    typeof received !== 'string' &&
    typeof received[Symbol.iterator] !== 'function' &&
    typeof received.contains !== 'function'
  ) {
    throw receivedError(this, 'toContain', 'must be a string or an iterable', received);
  }
  const isString = typeof received === 'string';
  return {
    pass: containsValue(received, expected),
    message: () =>
      `${this.hint('toContain')}\n\n${this.not(`Expected ${isString ? 'substring' : 'value'}:`)} ${printExpected(expected)}\nReceived ${isString ? 'string' : 'array'}:${this.isNot ? '    ' : ''} ${printReceived(received)}`,
  };
}

function toContainEqual(received, expected) {
  if (typeof received?.[Symbol.iterator] !== 'function') {
    throw receivedError(this, 'toContainEqual', 'must be an iterable', received);
  }
  return {
    pass: [...received].some((item) => equals(item, expected)),
    message: () =>
      `${this.hint('toContainEqual')}\n\n${this.not('Expected value:')} ${printExpected(expected)}\nReceived array:${this.isNot ? '    ' : ''} ${printReceived(received)}`,
  };
}

function toHaveLength(received, expected) {
  if (typeof received?.length !== 'number') {
    throw receivedError(this, 'toHaveLength', 'must have a length property whose value must be a number', received);
  }
  const pad = this.isNot ? '    ' : '';
  return {
    pass: received.length === expected,
    message: () =>
      `${this.hint('toHaveLength')}\n\n${this.not('Expected length:')} ${printExpected(expected)}\nReceived length:${pad} ${printReceived(received.length)}\nReceived value: ${pad} ${printReceived(received)}`,
  };
}

// "a.b[0]['c.d']" -> ['a', 'b', '0', 'c.d']
function parsePath(path) {
  if (Array.isArray(path)) {
    return path;
  }
  const parts = [];
  const regex = /[^.[\]]+|\[(?:(-?\d+(?:\.\d+)?)|(["'])((?:(?!\2)[^\\]|\\.)*?)\2)\]/g;
  let match = regex.exec(String(path));
  while (match) {
    parts.push(match[3] ?? match[1] ?? match[0]);
    match = regex.exec(String(path));
  }
  return parts;
}

// Every object inherits these: they count only as its own (as in vitest), or no object could be expected not to
// have them, which is what tests of prototype pollution expect.
const OWN_ONLY = new Set(['constructor', '__proto__', 'prototype']);

const hasPart = (value, part) => (OWN_ONLY.has(part) ? Object.hasOwn(Object(value), part) : part in Object(value));

// Follows a path; returns { found, value, last } where last is the deepest object reached.
function followPath(obj, parts) {
  let value = obj;
  let last = obj;
  for (let i = 0; i < parts.length; i += 1) {
    if (value === null || value === undefined || !hasPart(value, parts[i])) {
      return { found: false, value: undefined, last };
    }
    last = value;
    value = Object(value)[parts[i]];
  }
  return { found: true, value, last };
}

function toHavePropertyMessage(ctx, { path, hasValue, expected, found, value, last }) {
  const hint = ctx.hint('toHaveProperty', 'path', { secondArgument: hasValue ? 'value' : '' });
  const pathLine = `Expected path: ${printExpected(path)}`;
  const expectedLine = hasValue ? `Expected value: ${printExpected(expected)}\n` : '';
  if (ctx.isNot) {
    const notValue = hasValue ? `\nExpected value: not ${printExpected(expected)}` : '';
    const receivedValue = found ? `\nReceived value: ${printReceived(value)}` : '';
    return `${hint}\n\n${pathLine}\n${notValue}${receivedValue}`;
  }
  if (!found) {
    return `${hint}\n\n${pathLine}\nReceived path: ${printReceived(path)} (not found)\n\n${expectedLine}Received value: ${printReceived(last)}`;
  }
  return `${hint}\n\n${pathLine}\n\n${printDiffOrStringify(expected, value, 'Expected value', 'Received value')}`;
}

function toHaveProperty(received, path, ...rest) {
  if (received === null || received === undefined) {
    throw receivedError(this, 'toHaveProperty', 'must not be null nor undefined', received, 'path');
  }
  const hasValue = rest.length > 0;
  const [expected] = rest;
  const { found, value, last } = followPath(received, parsePath(path));
  return {
    pass: found && (!hasValue || equals(value, expected)),
    message: () => toHavePropertyMessage(this, { path, hasValue, expected, found, value, last }),
  };
}

function toMatch(received, expected) {
  if (typeof received !== 'string') {
    throw receivedError(this, 'toMatch', 'must be a string', received);
  }
  const isString = typeof expected === 'string';
  return {
    pass: isString ? received.includes(expected) : new RegExp(expected).test(received),
    message: () =>
      `${this.hint('toMatch')}\n\n${this.not(`Expected ${isString ? 'substring' : 'pattern'}:`)} ${printExpected(expected)}\nReceived string:${this.isNot ? '    ' : ''} ${printReceived(received)}`,
  };
}

module.exports = { toContain, toContainEqual, toHaveLength, toHaveProperty, toMatch };
