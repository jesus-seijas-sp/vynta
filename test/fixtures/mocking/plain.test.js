const { total } = require('./src/calc');

it('gets the real modules: mocks of other files do not leak', () => {
  expect(total([1, 2])).toBe(3);
});
