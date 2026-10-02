test('drops an assertion it did not await whose promise never settles, as Jest does', () => {
  expect(new Promise(() => {})).resolves.toBe(1);
});
