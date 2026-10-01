/* eslint-disable no-await-in-loop -- mock factories are settled in the order they were declared */
const fs = require('node:fs');
const path = require('node:path');
const { createRequire, isBuiltin } = require('node:module');
const { pathToFileURL } = require('node:url');
const state = require('../state');
const { resolveImportFile } = require('../resolve-paths');
const { automock } = require('./automock');

// Query that marks an import as the real module, which the resolve hook must not replace by its mock.
const ACTUAL = 'vynta-actual';

// While positive, require() loads real modules (requireActual) and the hooks serve files, not mocks.
const bypass = { depth: 0 };

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

function resolveToFile(entry) {
  try {
    const from = entry.from && path.isAbsolute(entry.from) ? entry.from : path.join(process.cwd(), 'index.js');
    const file = createRequire(from).resolve(entry.specifier);
    return path.isAbsolute(file) ? file : null;
  } catch {
    return null;
  }
}

// The real module of an entry, imported past the mocks. The marker in the query is what tells the
// hooks to serve the file rather than the mock, so a bare specifier has to be resolved to its file
// first: left as "swr", importOriginal() asks for the module it is itself standing in for, and a
// factory that awaits it waits on itself.
function importActual(entry) {
  if (entry.key.startsWith('node:')) {
    return import(entry.key);
  }
  const from = entry.from && path.isAbsolute(entry.from) ? path.dirname(entry.from) : process.cwd();
  const imported = entry.specifier && isBare(entry.specifier) ? resolveImportFile(entry.specifier, from) : null;
  const file = imported ?? (path.isAbsolute(entry.key) ? entry.key : resolveToFile(entry));
  if (!file) {
    return import(entry.key);
  }
  // The marker tells the ES module hooks to serve the file, but a CommonJS dependency is reached
  // through require(), which only reads the bypass. Both have to stand aside, or a factory asking
  // for the original of a CommonJS module is handed its own mock.
  bypass.depth += 1;
  let pending;
  try {
    pending = import(`${pathToFileURL(file).href}?${ACTUAL}=${state.generation}`);
  } catch (error) {
    bypass.depth -= 1;
    throw error;
  }
  return pending.finally(() => {
    bypass.depth -= 1;
  });
}

// The mock when there is no factory: a manual mock, or the real module (given by actual()) mocked.
function mockWithoutFactory(entry, actual) {
  const manual = manualMockFile(entry.specifier, entry.key);
  if (manual) {
    return { manual };
  }
  return { exports: automock(actual(), new Map(), entry.spy) };
}

const EXPORT_DECLARATION =
  /^\s*export\s+(?:declare\s+)?(?:async\s+)?(?:const|let|var|function\*?|class|enum)\s+([A-Za-z_$][\w$]*)/gm;
const EXPORT_LIST = /^\s*export\s*\{([^}]*)\}/gm;
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

// `a` or `a as b` from an export list: the name importers see.
function exportedName(item) {
  return item
    .trim()
    .split(/\s+as\s+/)
    .pop()
    ?.trim();
}

// The names a module file exports, read from its source; none when the key is not a file.
function exportedNames(key) {
  let source;
  try {
    source = fs.readFileSync(key, 'utf8');
  } catch {
    return [];
  }
  const declared = [...source.matchAll(EXPORT_DECLARATION)].map((match) => match[1]);
  const listed = [...source.matchAll(EXPORT_LIST)].flatMap(([, list]) => list.split(','));
  return [...declared, ...listed.filter((item) => !/^type\s/.test(item.trim())).map(exportedName)].filter(
    (name) => name && IDENTIFIER.test(name)
  );
}

// The modules a test file mocks, with vi.mock() / jest.mock(). Emptied when the file ends.
class ModuleMocks {
  constructor() {
    this.entries = new Map();
    this.actual = bypass;
  }

  get bypass() {
    return this.actual.depth;
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

  // A package with CommonJS and ES module builds resolves to a different file for import than for
  // require(), so a mock of a bare name also stands for every import of that name.
  lookup(key, specifier) {
    const entry = this.entries.get(key);
    if (entry || !specifier || !isBare(specifier)) {
      return entry;
    }
    return this.entries.get(specifier) ?? [...this.entries.values()].find((one) => one.specifier === specifier);
  }

  requireActual(specifier, from) {
    this.actual.depth += 1;
    try {
      return createRequire(from)(specifier);
    } finally {
      this.actual.depth -= 1;
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
    // Factories first: an automock imports the real module, and the mocked modules it imports in turn
    // must be ready by then.
    const pending = [...this.entries.values()]
      .filter((entry) => !entry.ready)
      .sort((a, b) => Number(!a.factory) - Number(!b.factory));
    for (let i = 0; i < pending.length; i += 1) {
      const entry = pending[i];
      entry.preparing = true;
      let exports;
      if (entry.factory) {
        exports = await entry.factory(() => importActual(entry));
      } else {
        const actual = await importActual(entry);
        const { manual, exports: mocked } = mockWithoutFactory(entry, () => actual);
        exports = manual ? await import(pathToFileURL(manual).href) : mocked;
      }
      Object.assign(entry, { ready: true, preparing: false, exports });
    }
  }

  // The source of the ES module standing for a mock: every key of its exports as an export, plus the
  // names the real module exports. An importer links against those even when the factory left one
  // out; vitest's mock is a proxy that allows it, and code that never touches the name still runs.
  moduleSource(key) {
    const entry = this.entries.get(key);
    if (!entry?.ready) {
      throw new Error(`The mock of "${entry?.specifier ?? key}" was not ready: call vi.mock() at the top of the file`);
    }
    const exports = entry.exports ?? {};
    const lines = [`const mocked = globalThis[Symbol.for('vynta.mocks')].entries.get(${JSON.stringify(key)}).exports;`];
    const names = [...new Set([...Object.keys(exports), ...exportedNames(key)])].filter((name) => name !== 'default');
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
