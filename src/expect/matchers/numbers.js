const { printReceived, printExpected, ensureNumbers } = require('../context');

function comparison(name, operator, compare) {
  return function matcher(received, expected) {
    ensureNumbers(received, expected, name);
    return {
      pass: compare(received, expected),
      message: () => {
        const pad = this.isNot ? '    ' : '';
        return `${this.hint(name)}\n\n${this.not('Expected:')} ${operator} ${printExpected(expected)}\nReceived:${pad} ${' '.repeat(operator.length)}${printReceived(received)}`;
      },
    };
  };
}

function toBeCloseTo(received, expected, precision = 2) {
  ensureNumbers(received, expected, 'toBeCloseTo');
  const expectedDiff = 10 ** -precision / 2;
  const receivedDiff = Math.abs(expected - received);
  // Equal infinities give NaN as difference, so they are checked first.
  const pass = received === expected || receivedDiff < expectedDiff;
  return {
    pass,
    message: () => {
      const hint = this.hint('toBeCloseTo', 'expected', { secondArgument: precision === 2 ? '' : 'precision' });
      const pad = this.isNot ? '    ' : '';
      return [
        hint,
        '',
        `${this.not('Expected:')} ${printExpected(expected)}`,
        `Received:${pad} ${printReceived(received)}`,
        '',
        `Expected precision:    ${printExpected(precision)}`,
        `Expected difference: ${this.isNot ? '>=' : '< '} ${printExpected(expectedDiff)}`,
        `Received difference:    ${printReceived(receivedDiff)}`,
      ].join('\n');
    },
  };
}

module.exports = {
  toBeGreaterThan: comparison('toBeGreaterThan', '>', (a, b) => a > b),
  toBeGreaterThanOrEqual: comparison('toBeGreaterThanOrEqual', '>=', (a, b) => a >= b),
  toBeLessThan: comparison('toBeLessThan', '<', (a, b) => a < b),
  toBeLessThanOrEqual: comparison('toBeLessThanOrEqual', '<=', (a, b) => a <= b),
  toBeCloseTo,
};
