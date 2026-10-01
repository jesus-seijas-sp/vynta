const { colors: c } = require('../../colors');
const { equals } = require('../equals');
const { printReceived, printExpected, printDiffOrStringify, printWithType, matcherError } = require('../context');

const MAX_CALLS_SHOWN = 10;

function ensureMock(ctx, received, name, expected) {
  if (typeof received !== 'function' || received._isMockFunction !== true) {
    throw matcherError(
      ctx.hint(name, expected),
      `${c.red('received')} value must be a mock or spy function`,
      printWithType('Received', received, printReceived)
    );
  }
}

function printCalls(calls) {
  if (calls.length === 0) {
    return `\nNumber of calls: ${printReceived(0)}`;
  }
  const lines = calls
    .slice(0, MAX_CALLS_SHOWN)
    .map((args, i) => `  ${i + 1}: ${args.map((arg) => printReceived(arg)).join(', ')}`);
  const more = calls.length > MAX_CALLS_SHOWN ? '\n  ...' : '';
  return `\nReceived:\n${lines.join('\n')}${more}\n\nNumber of calls: ${printReceived(calls.length)}`;
}

const printArgs = (args) => args.map((arg) => printExpected(arg)).join(', ');

function toHaveBeenCalled(received, expected) {
  ensureMock(this, received, 'toHaveBeenCalled', '');
  if (expected !== undefined) {
    throw matcherError(this.hint('toHaveBeenCalled', ''), 'this matcher must not have an expected argument');
  }
  const { calls } = received.mock;
  return {
    pass: calls.length > 0,
    message: () =>
      `${this.hint('toHaveBeenCalled', '')}\n\nExpected number of calls: ${this.isNot ? printExpected(0) : `>= ${printExpected(1)}`}${printCalls(calls)}`,
  };
}

function callCountMatcher(name, getExpected) {
  return function matcher(received, value) {
    const expected = getExpected(value);
    ensureMock(this, received, name, name === 'toHaveBeenCalledOnce' ? '' : 'expected');
    const count = received.mock.calls.length;
    return {
      pass: count === expected,
      message: () =>
        `${this.hint(name, name === 'toHaveBeenCalledOnce' ? '' : 'expected')}\n\n${this.not('Expected number of calls:')} ${printExpected(expected)}\nReceived number of calls:${this.isNot ? '    ' : ''} ${printReceived(count)}`,
    };
  };
}

// toHaveBeenCalledWith and its variants: select() picks the call to check and says whether it matches.
function calledWithMatcher(name, select) {
  return function matcher(received, ...expected) {
    ensureMock(this, received, name, '...expected');
    const { calls } = received.mock;
    const { pass, args } = select(calls, expected);
    return {
      pass,
      message: () => {
        const diff = args ? `\n\n${printDiffOrStringify(expected, args)}` : '';
        return `${this.hint(name, '...expected')}\n\n${this.not('Expected:')} ${printArgs(expected)}${diff}${printCalls(calls)}`;
      },
    };
  };
}

function toHaveBeenNthCalledWith(received, nth, ...expected) {
  ensureMock(this, received, 'toHaveBeenNthCalledWith', 'n, ...expected');
  const { calls } = received.mock;
  const args = calls[nth - 1];
  return {
    pass: args !== undefined && equals(args, expected),
    message: () => {
      const diff = args ? `\n\n${printDiffOrStringify(expected, args)}` : '';
      return `${this.hint('toHaveBeenNthCalledWith', 'n, ...expected')}\n\nn: ${nth}\n${this.not('Expected:')} ${printArgs(expected)}${diff}${printCalls(calls)}`;
    },
  };
}

const returned = (results) => results.filter((result) => result.type === 'return');

function returnMatcher(name, test) {
  return function matcher(received, ...args) {
    const expectedName = args.length > 0 ? 'expected' : '';
    ensureMock(this, received, name, expectedName);
    const { results } = received.mock;
    return {
      pass: test(results, args),
      message: () => {
        const values = returned(results);
        const expectedLine = args.length > 0 ? `${this.not('Expected:')} ${printArgs(args)}\n` : '';
        const receivedLine = values.map((result) => printReceived(result.value)).join(', ') || printReceived(0);
        return `${this.hint(name, expectedName)}\n\n${expectedLine}Received returns: ${receivedLine}\n\nNumber of returns: ${printReceived(values.length)}\nNumber of calls:   ${printReceived(results.length)}`;
      },
    };
  };
}

const returnedWith = (result, value) => result?.type === 'return' && equals(result.value, value);

module.exports = {
  toHaveBeenCalled,
  toHaveBeenCalledTimes: callCountMatcher('toHaveBeenCalledTimes', (value) => value),
  toHaveBeenCalledOnce: callCountMatcher('toHaveBeenCalledOnce', () => 1),
  toHaveBeenCalledWith: calledWithMatcher('toHaveBeenCalledWith', (calls, expected) => {
    const pass = calls.some((args) => equals(args, expected));
    return { pass, args: !pass && calls.length === 1 ? calls[0] : undefined };
  }),
  toHaveBeenCalledExactlyOnceWith: calledWithMatcher('toHaveBeenCalledExactlyOnceWith', (calls, expected) => ({
    pass: calls.length === 1 && equals(calls[0], expected),
    args: calls.length === 1 ? calls[0] : undefined,
  })),
  toHaveBeenLastCalledWith: calledWithMatcher('toHaveBeenLastCalledWith', (calls, expected) => {
    const args = calls.at(-1);
    return { pass: args !== undefined && equals(args, expected), args };
  }),
  toHaveBeenNthCalledWith,
  toHaveReturned: returnMatcher('toHaveReturned', (results) => returned(results).length > 0),
  toHaveReturnedTimes: returnMatcher('toHaveReturnedTimes', (results, [times]) => returned(results).length === times),
  toHaveReturnedWith: returnMatcher('toHaveReturnedWith', (results, [value]) =>
    results.some((result) => returnedWith(result, value))
  ),
  toHaveLastReturnedWith: returnMatcher('toHaveLastReturnedWith', (results, [value]) =>
    returnedWith(results.at(-1), value)
  ),
  toHaveNthReturnedWith: returnMatcher('toHaveNthReturnedWith', (results, [nth, value]) =>
    returnedWith(results[nth - 1], value)
  ),
};
