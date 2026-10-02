// A shared preset, as monorepos keep one at their root.
module.exports = {
  testMatch: ['**/tests/**/*.check.js'],
  setupFilesAfterEnv: [`${__dirname}/preset-setup.js`],
  testTimeout: 1234,
};
