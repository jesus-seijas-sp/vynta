// Only doMock and dontMock, which are not hoisted: the file still gets the mocking hooks.
test('jest.doMock and jest.dontMock work without a jest.mock in the file', () => {
  jest.doMock('dep', () => ({ name: 'done by doMock' }));
  expect(require('dep').name).toBe('done by doMock');
  jest.dontMock('dep');
  jest.resetModules();
  expect(require('dep').name).toBe('real dep');
});
