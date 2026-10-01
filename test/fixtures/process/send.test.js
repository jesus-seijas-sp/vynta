test('process.send exists', () => {
  expect(process.send({ operation: 'refresh' })).toBe(true);
});
