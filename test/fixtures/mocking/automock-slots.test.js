jest.mock('./src/services');

const { Factory, ioc } = require('./src/services');

it('mocks static methods, inherited ones included, and the prototype methods of instances', () => {
  expect(Factory.text('x')).toBeUndefined();
  expect(Factory.text).toHaveBeenCalledWith('x');
  expect(jest.isMockFunction(Factory.create)).toBe(true);
  expect(jest.isMockFunction(Factory.prototype.hello)).toBe(true);
  ioc.get.mockReturnValue('service');
  expect(ioc.get('name')).toBe('service');
});
