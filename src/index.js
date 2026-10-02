const collect = require('./collect/api');
const { expect } = require('./expect');
const { vi } = require('./vi');

const api = { ...collect, expect, vi, vitest: vi, jest: vi };

const GLOBALS = [
  'describe',
  'suite',
  'it',
  'test',
  'beforeAll',
  'afterAll',
  'beforeEach',
  'afterEach',
  'onTestFinished',
  'onTestFailed',
  'expect',
  'vi',
  'vitest',
  'jest',
];

// describe, it, expect, vi, jest... as globals, like Jest (and vitest with globals: true).
function installGlobals(target = globalThis) {
  GLOBALS.forEach((name) => {
    Object.defineProperty(target, name, { value: api[name], writable: true, configurable: true });
  });
  // The jasmine fail() some Jest suites still use.
  if (!('fail' in target)) {
    Object.defineProperty(target, 'fail', {
      value: (message = 'fail() was called') => {
        throw new Error(message);
      },
      writable: true,
      configurable: true,
    });
  }
}

module.exports = { ...api, installGlobals };
