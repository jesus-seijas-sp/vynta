const { colors: c } = require('../../colors');
const { printReceived, printExpected, printWithType, matcherError } = require('../context');

// What was thrown, as { value }, or null when nothing was. With .rejects the rejection is what was thrown; with
// .resolves, as in Jest, only a resolved Error counts as thrown.
function getThrown(ctx, received, expected) {
  if (ctx.promise === 'rejects') {
    return { value: received };
  }
  if (ctx.promise === 'resolves') {
    return received instanceof Error ? { value: received } : null;
  }
  if (typeof received !== 'function') {
    throw matcherError(
      ctx.hint('toThrow', expected === undefined ? '' : 'expected'),
      `${c.red('received')} value must be a function`,
      printWithType('Received', received, printReceived)
    );
  }
  try {
    received();
  } catch (error) {
    return { value: error };
  }
  return null;
}

const messageOf = (value) => (typeof value?.message === 'string' ? value.message : String(value));

function printThrown(thrown) {
  if (!thrown) {
    return 'Received function did not throw';
  }
  return thrown.value instanceof Error
    ? `Received message: ${printReceived(thrown.value.message)}`
    : `Received value: ${printReceived(thrown.value)}`;
}

// How each kind of expected value is checked against what was thrown.
function checkThrown(ctx, thrown, expected) {
  if (expected === undefined) {
    return {
      pass: thrown !== null,
      details: () => (ctx.isNot ? `Error name:    ${printReceived(thrown.value?.name)}\n` : ''),
    };
  }
  if (typeof expected === 'string') {
    return {
      pass: thrown !== null && messageOf(thrown.value).includes(expected),
      details: () => `${ctx.not('Expected substring:')} ${printExpected(expected)}\n`,
    };
  }
  if (expected instanceof RegExp) {
    return {
      pass: thrown !== null && expected.test(messageOf(thrown.value)),
      details: () => `${ctx.not('Expected pattern:')} ${printExpected(expected)}\n`,
    };
  }
  if (typeof expected === 'function') {
    return {
      pass: thrown !== null && thrown.value instanceof expected,
      details: () => {
        const got = thrown?.value?.constructor?.name;
        return `${ctx.not('Expected constructor:')} ${c.green(expected.name)}\n${thrown ? `Received constructor: ${c.red(got)}\n` : ''}`;
      },
    };
  }
  if (typeof expected?.asymmetricMatch === 'function') {
    return {
      pass: thrown !== null && expected.asymmetricMatch(thrown.value),
      details: () => `Expected asymmetric matcher: ${printExpected(expected)}\n`,
    };
  }
  if (expected !== null && typeof expected === 'object') {
    return {
      pass: thrown !== null && messageOf(thrown.value) === expected.message,
      details: () => `${ctx.not('Expected message:')} ${printExpected(expected.message)}\n`,
    };
  }
  throw matcherError(
    ctx.hint('toThrow'),
    `${c.green('expected')} value must be a string or regular expression or class or error`
  );
}

function toThrow(received, expected) {
  const thrown = getThrown(this, received, expected);
  const { pass, details } = checkThrown(this, thrown, expected);
  return {
    pass,
    message: () =>
      `${this.hint('toThrow', expected === undefined ? '' : 'expected')}\n\n${details()}${printThrown(thrown)}`,
  };
}

module.exports = { toThrow, toThrowError: toThrow };
