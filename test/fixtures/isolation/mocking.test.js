jest.mock('dep', () => ({ name: 'mocked dep' }));

test("requireActual gives the real module, whose own dependencies still get their mocks", () => {
  expect(jest.requireActual('uses-dep').depName()).toBe('mocked dep');
});

test('a rejection handled after fake timers ran is not an unhandled one', async () => {
  jest.useFakeTimers();
  const late = new Promise((resolve, reject) => {
    setTimeout(() => reject(new Error('late')), 10);
  });
  await jest.runAllTimersAsync();
  await expect(late).rejects.toThrow('late');
  jest.useRealTimers();
});

test('a timeout of 0 runs with advanceTimersByTime(0), as with sinon', () => {
  jest.useFakeTimers();
  let ran = false;
  setTimeout(() => {
    ran = true;
  }, 0);
  jest.advanceTimersByTime(0);
  expect(ran).toBe(true);
  jest.useRealTimers();
});

test.each(['abc', [], {}])('a table that is not all arrays gives each value as one argument: %p', (value) => {
  expect(value).not.toBeUndefined();
});
