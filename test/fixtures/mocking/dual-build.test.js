jest.mock('dual-build');

const client = require('dual-build');

it('automocks what require() loads of a package with an ES module build too', () => {
  expect(jest.isMockFunction(client)).toBe(true);
  client.mockReturnValueOnce('mocked');
  expect(client('/a')).toBe('mocked');
  expect(jest.isMockFunction(client.post)).toBe(true);
});
