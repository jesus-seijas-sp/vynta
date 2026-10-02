test('runs the files the preset matches, with its setup files before the config ones', () => {
  expect(globalThis.order).toEqual(['preset', 'config']);
});
