/* eslint-disable no-await-in-loop -- mock factories are settled in the order they were declared */
const fs = require('node:fs');
const path = require('node:path');
const { createRequire, isBuiltin } = require('node:module');
const { pathToFileURL } = require('node:url');
const state = require('../state');
const { resolveImportFile } = require('../resolve-paths');
const { orderMocks } = require('./mock-order');
const { automock } = require('./automock');

// Query that marks an import as the real module, which the resolve hook must not replace by its mock.
const ACTUAL = 'vyntra-actual';

const isThenable = (value) => typeof value?.then === 'function';

// The mocked modules require() loads for real for now (requireActual, importActual), by key, with how many times
// each is asked for: only the module asked for is the real one, as in Jest; what it requires gets its mocks.
const bypassed = new Map();

function bypass(key, load) {
  bypassed.set(key, (bypassed.get(key) ?? 0) + 1);
  const release = () => {
    const count = bypassed.get(key) - 1;
    if (count > 0) {
      bypassed.set(key, count);
    } else {
      bypassed.delete(key);
    }
  };
  let result;
  try {
    result = load();
  } catch (error) {
    release();
    throw error;
  }
  if (isThenable(result)) {
    return result.finally(release);
  }
  release();
  return result;
}

// Whether require() of this mocked module gets the real one now (see bypass()).
const isBypassed = (key) => bypassed.has(key);

const isBare = (specifier) =>
  !specifier.startsWith('.') && !path.isAbsolute(specifier) && !specifier.startsWith('file:');

// The key of a module: node:name for builtins, the resolved file for the others. A module that can not be resolved
// (a virtual mock) is keyed by its specifier, or its path when relative.
function resolveKey(specifier, from) {
  if (isBuiltin(specifier)) {
    return specifier.startsWith('node:') ? specifier : `node:${specifier}`;
  }
  // A package's own paths go by the file an import loads: under require() an exports map may send
  // several of them to one file (every icon of @phosphor-icons/react to its CommonJS bundle), and their
  // mocks would replace each other.
  if (isBare(specifier) && from && path.isAbsolute(from)) {
    const imported = resolveImportFile(specifier, path.dirname(from));
    if (imported) {
      return imported;
    }
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
  return bypass(entry.key, () => import(`${pathToFileURL(file).href}?${ACTUAL}=${state.generation}`));
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

// Runs a deferred factory as its module is imported. The ES module hooks are synchronous, so the
// factory must be too.
function settleDeferred(entry) {
  if (entry.factory.constructor.name === 'AsyncFunction') {
    throw new Error(
      `The async mock factory of "${entry.specifier}" was needed before it could run: it reads a variable declared after it, or an automocked module imports it`
    );
  }
  const exports = entry.factory(() => importActual(entry));
  if (isThenable(exports)) {
    throw new Error(`The mock factory of "${entry.specifier}" returned a promise where it had to run synchronously`);
  }
  Object.assign(entry, { ready: true, deferred: false, exports });
}

// The modules a test file mocks, with vi.mock() / jest.mock(). Emptied when the file ends.
class ModuleMocks {
  constructor() {
    this.entries = new Map();
    // The modules loaded when the file registered its first mock, and whether it mocked a builtin (see stale()).
    this.loadedBefore = null;
    this.mocksBuiltin = false;
  }

  get size() {
    return this.entries.size;
  }

  register(specifier, from, { factory, spy = false } = {}) {
    this.loadedBefore ??= new Set(Object.keys(require.cache));
    const key = resolveKey(specifier, from);
    this.mocksBuiltin ||= key.startsWith('node:');
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
    const entry = this.lookup(resolveKey(specifier, from), specifier);
    const load = () => createRequire(from)(specifier);
    return entry ? bypass(entry.key, load) : load();
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
      // The real module as require() loads it: a package's key is the file an import loads (its ES module build,
      // whose namespace is not what require() returns), so it is required by its specifier.
      const actual = () => {
        try {
          return this.requireActual(entry.specifier, entry.from);
        } catch {
          return this.requireActual(entry.key, entry.from);
        }
      };
      const { manual, exports: mocked } = mockWithoutFactory(entry, actual);
      exports = manual ? this.requireActual(manual, entry.from) : mocked;
    }
    Object.assign(entry, { ready: true, exports });
    return exports;
  }

  // Settles every mock for the ES module loader, whose hooks are synchronous: runs the (maybe async) factories and
  // imports what automocks need, before the test file imports anything.
  async prepare() {
    // Each after the mocks its real module imports. A mock with a synchronous factory imported before
    // its turn settles there and then, as vitest's would.
    const pending = orderMocks(
      [...this.entries.values()].filter((entry) => !entry.ready),
      (key, specifier) => this.lookup(key, specifier),
      resolveKey
    );
    for (let i = 0; i < pending.length; i += 1) {
      const entry = pending[i];
      if (entry.ready) {
        // eslint-disable-next-line no-continue -- settled when something imported it first
        continue;
      }
      entry.preparing = true;
      let exports;
      if (entry.factory) {
        try {
          exports = await entry.factory(() => importActual(entry));
        } catch (error) {
          if (!(error instanceof ReferenceError)) {
            throw error;
          }
          // The factory reads a variable the file declares further down, which vitest allows: it runs a
          // factory when the module is first imported. This one waits for that import.
          Object.assign(entry, { preparing: false, deferred: true });
          // eslint-disable-next-line no-continue -- the entry stays unsettled until it is imported
          continue;
        }
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
    if (entry && !entry.ready && entry.factory && !entry.preparing) {
      settleDeferred(entry);
    }
    if (!entry?.ready) {
      throw new Error(`The mock of "${entry?.specifier ?? key}" was not ready: call vi.mock() at the top of the file`);
    }
    const exports = entry.exports ?? {};
    const lines = [
      `const mocked = globalThis[Symbol.for('vyntra.mocks')].entries.get(${JSON.stringify(key)}).exports;`,
    ];
    const names = [...new Set([...Object.keys(exports), ...exportedNames(key)])].filter((name) => name !== 'default');
    names.forEach((name, i) => {
      lines.push(`const e${i} = mocked[${JSON.stringify(name)}];`, `export { e${i} as ${JSON.stringify(name)} };`);
    });
    // A CommonJS-style mock (no default key) is its own default export.
    lines.push(`export default ${'default' in exports ? 'mocked.default' : 'mocked'};`);
    return lines.join('\n');
  }

  // The modules not to leave loaded for the next file, which otherwise keeps node_modules loaded. Those loaded after
  // the file's first mock may hold it (a package that required a mocked axios), so they go; those loaded before can
  // not, nor can they hold one of these, so no package ends up in two copies. A mocked builtin reaches further: a
  // package loaded before still requires fs, and a test that mocks fs changes packages too (fs-extra's
  // createWriteStream = jest.fn()), so then everything goes, as under Jest, where every file loads its own copy.
  stale() {
    if (!this.loadedBefore) {
      return [];
    }
    const loaded = Object.keys(require.cache);
    return this.mocksBuiltin ? loaded : loaded.filter((key) => !this.loadedBefore.has(key));
  }

  clear() {
    this.entries.clear();
    this.loadedBefore = null;
    this.mocksBuiltin = false;
  }
}

const mocks = new ModuleMocks();
globalThis[Symbol.for('vyntra.mocks')] = mocks;

module.exports = { mocks, resolveKey, importActual, isBypassed, ACTUAL };
