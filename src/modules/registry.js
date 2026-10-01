/* eslint-disable no-await-in-loop -- mock factories are settled in the order they were declared */
const fs = require('node:fs');
const path = require('node:path');
const { createRequire, isBuiltin } = require('node:module');
const { pathToFileURL } = require('node:url');
const state = require('../state');
const { automock } = require('./automock');

// Query that marks an import as the real module, which the resolve hook must not replace by its mock.
const ACTUAL = 'vynta-actual';

const isThenable = (value) => typeof value?.then === 'function';
const isBare = (specifier) =>
  !specifier.startsWith('.') && !path.isAbsolute(specifier) && !specifier.startsWith('file:');

// The key of a module: node:name for builtins, the resolved file for the others. A module that can not be resolved
// (a virtual mock) is keyed by its specifier, or its path when relative.
function resolveKey(specifier, from) {
  if (isBuiltin(specifier)) {
    return specifier.startsWith('node:') ? specifier : `node:${specifier}`;
  }
  try {
    return createRequire(from).resolve(specifier);
  } catch {
    return isBare(specifier) ? specifier : path.resolve(path.dirname(from), specifier);
  }
}

// Jest's manual mocks: __mocks__/name next to a project module, or in the project root for packages and builtins.
function manualMockFile(specifier, key) {
  const candidates = path.isAbsolute(key)
    ? [path.join(path.dirname(key), '__mocks__', path.basename(key))]
    : ['.js', '.cjs', '.mjs', '.ts'].map((ext) =>
        path.join(state.config.rootDir ?? process.cwd(), '__mocks__', `${specifier.replace(/^node:/, '')}${ext}`)
      );
  return candidates.find((file) => fs.existsSync(file));
}

// The real module of an entry, imported past the mocks.
function importActual(entry) {
  const url =
    entry.key.startsWith('node:') || !path.isAbsolute(entry.key)
      ? entry.key
      : `${pathToFileURL(entry.key).href}?${ACTUAL}=${state.generation}`;
  return import(url);
}

// The mock when there is no factory: a manual mock, or the real module (given by actual()) mocked.
function mockWithoutFactory(entry, actual) {
  const manual = manualMockFile(entry.specifier, entry.key);
  if (manual) {
    return { manual };
  }
  return { exports: automock(actual(), new Map(), entry.spy) };
}

// The modules a test file mocks, with vi.mock() / jest.mock(). Emptied when the file ends.
class ModuleMocks {
  constructor() {
    this.entries = new Map();
    // While positive, require() loads real modules (requireActual).
    this.bypass = 0;
  }

  get size() {
    return this.entries.size;
  }

  register(specifier, from, { factory, spy = false } = {}) {
    const key = resolveKey(specifier, from);
    this.entries.set(key, { key, specifier, from, factory, spy, ready: false, exports: undefined });
  }

  unregister(specifier, from) {
    this.entries.delete(resolveKey(specifier, from));
  }

  lookup(key, specifier) {
    return this.entries.get(key) ?? (specifier && isBare(specifier) ? this.entries.get(specifier) : undefined);
  }

  requireActual(specifier, from) {
    this.bypass += 1;
    try {
      return createRequire(from)(specifier);
    } finally {
      this.bypass -= 1;
    }
  }

  // The exports of a mocked module for require(): factories must be synchronous there.
  cjsExports(entry) {
    if (entry.ready) {
      return entry.exports;
    }
    let exports;
    if (entry.factory) {
      exports = entry.factory(() => importActual(entry));
      if (isThenable(exports)) {
        throw new Error(
          `The mock factory of "${entry.specifier}" is async, so the module can only be imported (ESM), not required`
        );
      }
    } else {
      const { manual, exports: mocked } = mockWithoutFactory(entry, () => this.requireActual(entry.key, entry.from));
      exports = manual ? this.requireActual(manual, entry.from) : mocked;
    }
    Object.assign(entry, { ready: true, exports });
    return exports;
  }

  // Settles every mock for the ES module loader, whose hooks are synchronous: runs the (maybe async) factories and
  // imports what automocks need, before the test file imports anything.
  async prepare() {
    const pending = [...this.entries.values()].filter((entry) => !entry.ready);
    for (let i = 0; i < pending.length; i += 1) {
      const entry = pending[i];
      let exports;
      if (entry.factory) {
        exports = await entry.factory(() => importActual(entry));
      } else {
        const actual = await importActual(entry);
        const { manual, exports: mocked } = mockWithoutFactory(entry, () => actual);
        exports = manual ? await import(pathToFileURL(manual).href) : mocked;
      }
      Object.assign(entry, { ready: true, exports });
    }
  }

  // The source of the ES module standing for a mock: every key of its exports as an export.
  moduleSource(key) {
    const entry = this.entries.get(key);
    if (!entry?.ready) {
      throw new Error(`The mock of "${entry?.specifier ?? key}" was not ready: call vi.mock() at the top of the file`);
    }
    const exports = entry.exports ?? {};
    const lines = [`const mocked = globalThis[Symbol.for('vynta.mocks')].entries.get(${JSON.stringify(key)}).exports;`];
    const names = Object.keys(exports).filter((name) => name !== 'default');
    names.forEach((name, i) => {
      lines.push(`const e${i} = mocked[${JSON.stringify(name)}];`, `export { e${i} as ${JSON.stringify(name)} };`);
    });
    // A CommonJS-style mock (no default key) is its own default export.
    lines.push(`export default ${'default' in exports ? 'mocked.default' : 'mocked'};`);
    return lines.join('\n');
  }

  clear() {
    this.entries.clear();
  }
}

const mocks = new ModuleMocks();
globalThis[Symbol.for('vynta.mocks')] = mocks;

module.exports = { mocks, resolveKey, importActual, ACTUAL };
