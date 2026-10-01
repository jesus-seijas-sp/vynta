const path = require('node:path');
const state = require('../state');
const { isolateModules } = require('../loader');
const { userFrames } = require('../utils/stack');
const { automock } = require('./automock');
const { installCjs } = require('./hooks');
const { mocks, resolveKey, importActual: importEntry } = require('./registry');

// The file that called vi.mock(): relative specifiers are relative to it.
function callerFile() {
  return userFrames(new Error().stack)[0]?.file ?? state.file?.path ?? path.join(process.cwd(), 'index.js');
}

// vi.mock(path, factory?) / vi.mock(path, { spy }) / jest.mock(path, factory?, { virtual }).
function mock(specifier, factoryOrOptions, options = {}) {
  installCjs();
  const factory = typeof factoryOrOptions === 'function' ? factoryOrOptions : undefined;
  const { spy } = typeof factoryOrOptions === 'object' && factoryOrOptions !== null ? factoryOrOptions : options;
  mocks.register(specifier, callerFile(), { factory, spy });
}

function unmock(specifier) {
  mocks.unregister(specifier, callerFile());
}

function requireActual(specifier) {
  return mocks.requireActual(specifier, callerFile());
}

function importActual(specifier) {
  const from = callerFile();
  return importEntry({ key: resolveKey(specifier, from), specifier, from });
}

// The mocked version of a module, whether it is mocked or not.
function requireMock(specifier) {
  const from = callerFile();
  const entry = mocks.lookup(resolveKey(specifier, from), specifier);
  return entry ? mocks.cjsExports(entry) : automock(mocks.requireActual(specifier, from));
}

async function importMock(specifier) {
  return automock(await importActual(specifier));
}

// jest.isolateModules(fn): the modules fn loads are its own.
function isolate(fn) {
  isolateModules();
  try {
    fn();
  } finally {
    isolateModules();
  }
}

async function isolateAsync(fn) {
  isolateModules();
  try {
    await fn();
  } finally {
    isolateModules();
  }
}

module.exports = {
  mock,
  doMock: mock,
  unmock,
  doUnmock: unmock,
  requireActual,
  importActual,
  requireMock,
  importMock,
  isolateModules: isolate,
  isolateModulesAsync: isolateAsync,
  resetModules: isolateModules,
  // Automocking everything is not supported; the calls are accepted.
  enableAutomock: () => {},
  disableAutomock: () => {},
};
