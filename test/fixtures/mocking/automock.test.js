jest.mock('./src/math');

const { add, PI, Calculator } = require('./src/math');

it('replaces functions and class methods by mocks, keeping primitives', () => {
  expect(add(1, 2)).toBeUndefined();
  expect(add).toHaveBeenCalledWith(1, 2);
  expect(PI).toBe(3.14);
  const calculator = new Calculator();
  expect(calculator.double(2)).toBeUndefined();
  expect(Calculator.prototype.double).toHaveBeenCalledTimes(1);
});
