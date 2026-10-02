// Each file checks it starts as a fresh Jest file would, then leaves things changed for the next one.
jest.mock('./helper', () => ({ mocked: true }));

test('starts with what a fresh file has, whatever ran before in the thread', () => {
  expect(require('./helper').mocked).toBe(true);
  expect(process.env.ISOLATION_MARK).toBeUndefined();
  expect(require('shared-pkg').value).toBe('real');
  expect(globalThis.definedOnce).toBe('value');
  process.env.ISOLATION_MARK = 'left over';
  require('shared-pkg').value = 'changed';
});
