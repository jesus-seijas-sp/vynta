// A test that signals its own process, as Nest's shutdown hooks do: its listener gets the signal and the run goes on.
test('a signal sent to the own process reaches its listener', async () => {
  const received = new Promise((resolve) => {
    process.once('SIGTERM', resolve);
  });
  process.kill(process.pid, 'SIGTERM');
  expect(await received).toBe('SIGTERM');
});
