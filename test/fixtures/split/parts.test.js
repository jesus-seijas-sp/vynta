// Every test records the thread that ran it: run in parts, the file uses several.
const { threadId } = require('node:worker_threads');

let setups = 0;
beforeAll(() => {
  setups += 1;
});

describe('independent tests', () => {
  it.each([0, 1, 2, 3, 4, 5])('test %i', (index) => {
    expect(setups).toBe(1);
    console.log(`test ${index} on thread ${threadId}`);
  });
});
