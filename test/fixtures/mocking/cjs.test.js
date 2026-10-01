const { total } = require('./src/calc');
const math = require('./src/math');
const logger = require('./src/logger');
const thing = require('virtual-thing');

jest.mock('./src/math', () => ({
  // Multiplies instead (a comment with a paren: ")").
  add: jest.fn((a, b) => a * 10 + b),
}));
jest.mock('./src/logger');
jest.mock('virtual-thing', () => ({ value: 'virtual' }), { virtual: true });

describe('jest.mock in CommonJS', () => {
  it('is hoisted above the requires, also for modules required indirectly', () => {
    expect(total([1, 2])).toBe(12);
    expect(math.add).toHaveBeenCalledTimes(2);
  });

  it('uses manual mocks from __mocks__', () => {
    expect(logger.log()).toBe('manual mock');
  });

  it('supports virtual modules', () => {
    expect(thing.value).toBe('virtual');
  });

  it('gives the real module with requireActual', () => {
    expect(jest.requireActual('./src/math').add(1, 2)).toBe(3);
  });
});
