const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { pathToFileURL } = require('node:url');
const state = require('./state');

// Test files that call vi.mock() / jest.mock() get it hoisted; checked on the source, before loading them.
const MOCK_CALL = /\b(?:vi|jest)\s*\.\s*(?:mock|unmock|hoisted)\s*\(/;

// Only vynta's runtime stays loaded between files; vynta's own tests are isolated like any other project files.
const RUNTIME_DIR = `${__dirname}${path.sep}`;
const RUNTIME_URL = `${pathToFileURL(__dirname).href}/`;
const ENTRY_CJS = path.join(__dirname, 'index.js');
const ENTRY_ESM = pathToFileURL(path.join(__dirname, 'index.mjs')).href;
const NODE_MODULES = `${path.sep}node_modules${path.sep}`;

// Imports of other test frameworks resolve to vynta, so their test files run unchanged.
const ALIASES = new Set(['vynta', 'vitest', 'vitest/globals', '@jest/globals', '@vitest/expect']);

const hooked = { cjs: false, esm: false };

function hookCjs() {
  if (hooked.cjs) {
    return;
  }
  hooked.cjs = true;
  // The one CommonJS resolution hook Node.js has.
  const resolveFilename = Module._resolveFilename;
  Module._resolveFilename = function vyntaResolveFilename(request, ...rest) {
    return ALIASES.has(request) ? ENTRY_CJS : resolveFilename.call(this, request, ...rest);
  };
}

// ES modules can not be evicted from the cache, so each test file imports its own copy of the project modules,
// told apart by a query string. Dependencies in node_modules are shared.
function isolatedUrl(url, conditions) {
  const isProjectModule =
    url.startsWith('file:') &&
    !url.includes('/node_modules/') &&
    !url.startsWith(RUNTIME_URL) &&
    !url.includes('vynta=');
  if (!isProjectModule || state.generation === 0 || !conditions.includes('import')) {
    return url;
  }
  return `${url}${url.includes('?') ? '&' : '?'}vynta=${state.generation}`;
}

function hookEsm(config) {
  if (hooked.esm || typeof Module.registerHooks !== 'function') {
    return;
  }
  hooked.esm = true;
  const isolate = config.isolate !== false;
  Module.registerHooks({
    resolve(specifier, context, nextResolve) {
      if (ALIASES.has(specifier)) {
        const url = context.conditions.includes('require') ? pathToFileURL(ENTRY_CJS).href : ENTRY_ESM;
        return { url, shortCircuit: true };
      }
      const result = nextResolve(specifier, context);
      return isolate ? { ...result, url: isolatedUrl(result.url, context.conditions) } : result;
    },
  });
}

// The "type" of the package a directory belongs to, cached per directory.
const packageTypes = new Map();

function packageType(dir) {
  if (!packageTypes.has(dir)) {
    let type;
    try {
      type =
        JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).type === 'module' ? 'module' : 'commonjs';
    } catch {
      const parent = path.dirname(dir);
      type = parent === dir ? 'commonjs' : packageType(parent);
    }
    packageTypes.set(dir, type);
  }
  return packageTypes.get(dir);
}

function isEsm(file) {
  const ext = path.extname(file);
  if (ext === '.mjs' || ext === '.mts') {
    return true;
  }
  if (ext === '.cjs' || ext === '.cts') {
    return false;
  }
  return packageType(path.dirname(file)) === 'module';
}

function checkSupported(file) {
  const ext = path.extname(file);
  if (/^\.[cm]?ts$/.test(ext) && !process.features.typescript) {
    throw new Error(`Can not run ${file}: TypeScript needs Node.js 22.18 or later (or --experimental-strip-types)`);
  }
  if (ext === '.tsx' || ext === '.jsx') {
    throw new Error(`Can not run ${file}: JSX needs a transform, which vynta does not have yet`);
  }
}

// Loads a test or setup file. `fresh` evaluates it again even when it is cached (setup files run for every file).
async function loadModule(file, config, fresh) {
  hookCjs();
  checkSupported(file);
  if (MOCK_CALL.test(fs.readFileSync(file, 'utf8'))) {
    // eslint-disable-next-line global-require -- the mocking hooks are only loaded by the files that mock
    require('./modules/hooks').enableMocking(file, isEsm(file));
  }
  if (isEsm(file)) {
    hookEsm(config);
    const version = fresh || config.isolate !== false ? `?vynta=${state.generation}` : '';
    return import(`${pathToFileURL(file).href}${version}`);
  }
  if (fresh) {
    delete require.cache[file];
  }
  // eslint-disable-next-line global-require -- loading test files is the point
  return require(file);
}

// Forgets the project modules loaded by a test file, keeping node_modules (and the runtime) warm.
function isolateModules() {
  state.generation += 1;
  Object.keys(require.cache)
    .filter((key) => !key.includes(NODE_MODULES) && !key.startsWith(RUNTIME_DIR))
    .forEach((key) => {
      delete require.cache[key];
    });
}

module.exports = { loadModule, isolateModules, isEsm, hookCjs, ALIASES };
