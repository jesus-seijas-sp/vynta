// Runtime state shared by every copy of vyntra loaded in the same thread (a test file may resolve its own copy of
// the package), so it lives in a global slot rather than in this module.
const KEY = Symbol.for('vyntra.state');

globalThis[KEY] ??= {
  config: {},
  // The file being collected and run.
  file: null,
  // The suite that describe/it/hooks add to while collecting.
  suite: null,
  // The test running now, if any.
  test: null,
  // Bumped for every test file, so ES modules are loaded fresh (see loader.js).
  generation: 0,
};

module.exports = globalThis[KEY];
