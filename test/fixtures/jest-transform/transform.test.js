const { value } = require('./src/lib');

test('compiles the project files with its Jest transformer', () => {
  expect(value).toBe('transformed');
  expect(WORD).toBe('transformed');
});

test("tells Jest's snapshot mode to tests that read it", () => {
  expect(expect.getState().snapshotState._updateSnapshot).toBe('new');
});
