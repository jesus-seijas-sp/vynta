// Runs after json.test.mjs in the same worker (with --maxWorkers 1): then require() goes through the loader hooks.
const data = require('./data.json');

describe('json from commonjs', () => {
  it('is the object for a require of a CommonJS test', () => {
    expect(data).toEqual({ answer: 42, list: [1, 2] });
  });
});
