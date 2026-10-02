const path = require('node:path');
const Module = require('node:module');
const { fileURLToPath } = require('node:url');
const state = require('../state');
const { hoistMocks } = require('./hoist');
const { mocks, resolveKey, isBypassed, ACTUAL } = require('./registry');

const MOCK_SCHEME = 'vyntra-mock:';

// Files whose vi.mock() calls are hoisted: the test and setup files that call them.
const hoistTargets = new Set();

const installed = { cjs: false, esm: false, compile: false };

const toPath = (url) => (url.startsWith('file:') ? fileURLToPath(url.replace(/\?.*$/, '')) : url);

// require() of a mocked module returns the mock. Checked before the module cache, as Jest's registry does.
function installCjs() {
  if (installed.cjs) {
    return;
  }
  installed.cjs = true;
  const load = Module._load;
  Module._load = function vyntraLoad(request, parent, ...rest) {
    if (mocks.size > 0) {
      const from = parent?.filename ?? path.join(process.cwd(), 'index.js');
      const entry = mocks.lookup(resolveKey(request, from), request);
      if (entry && !isBypassed(entry.key)) {
        return mocks.cjsExports(entry);
      }
    }
    return load.call(this, request, parent, ...rest);
  };
}

function resolveHook(specifier, context, nextResolve) {
  if (mocks.size === 0 || !context.conditions.includes('import') || specifier.includes(ACTUAL)) {
    return nextResolve(specifier, context);
  }
  let result;
  try {
    result = nextResolve(specifier, context);
  } catch (error) {
    // A virtual mock: nothing to resolve, but a mock to serve.
    if (!mocks.lookup(specifier, specifier)) {
      throw error;
    }
    result = { url: specifier };
  }
  const entry = mocks.lookup(toPath(result.url), specifier);
  if (!entry) {
    return result;
  }
  if (entry.preparing && result.url.startsWith('file:')) {
    // Imported again from inside its own factory, by a module the original imports (a cycle back to
    // it): the original stands in, the same instance importOriginal() is loading.
    return { ...result, url: `${result.url.replace(/\?.*$/, '')}?${ACTUAL}=${state.generation}`, shortCircuit: true };
  }
  return {
    url: `${MOCK_SCHEME}${state.generation}:${encodeURIComponent(entry.key)}`,
    format: 'module',
    shortCircuit: true,
  };
}

function loadHook(url, context, nextLoad) {
  if (url.startsWith(MOCK_SCHEME)) {
    const key = decodeURIComponent(url.slice(url.indexOf(':', MOCK_SCHEME.length) + 1));
    return { format: 'module', source: mocks.moduleSource(key), shortCircuit: true };
  }
  const result = nextLoad(url, context);
  if (hoistTargets.size === 0 || !url.startsWith('file:') || !hoistTargets.has(toPath(url)) || !result.source) {
    return result;
  }
  const esm = result.format === 'module' || result.format === 'module-typescript';
  const hoisted = hoistMocks(String(result.source), { esm });
  return hoisted ? { ...result, source: hoisted } : result;
}

function installEsm() {
  if (installed.esm) {
    return;
  }
  if (typeof Module.registerHooks !== 'function') {
    throw new Error('vi.mock() needs Node.js 22.15 or later (module.registerHooks)');
  }
  installed.esm = true;
  state.loaderHooks = true;
  Module.registerHooks({ resolve: resolveHook, load: loadHook });
}

// Hoisting for CommonJS files, when they are compiled. Loader hooks would do it too, but once registered every
// require() of the thread goes through them, which makes loading a large dependency tree much slower.
function installCjsHoisting() {
  if (installed.compile) {
    return;
  }
  installed.compile = true;
  const compile = Module.prototype._compile;
  Module.prototype._compile = function compileHoisted(content, filename, ...rest) {
    const hoisted = hoistTargets.has(filename) ? hoistMocks(content) : null;
    return compile.call(this, hoisted ?? content, filename, ...rest);
  };
}

// Prepares the loaders for a file that mocks modules: its mock calls are hoisted and mocked modules served. The
// loader hooks are only needed by ES modules.
function enableMocking(file, esm) {
  installCjs();
  if (esm) {
    installEsm();
  } else {
    installCjsHoisting();
  }
  hoistTargets.add(file);
}

module.exports = { enableMocking, installCjs };
