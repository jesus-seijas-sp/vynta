const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { pathToFileURL, fileURLToPath } = require('node:url');
const state = require('./state');
const { isSpyable, makeSpyable, markSpyable } = require('./modules/spyable');
const { installCjsLoader, nearestType } = require('./cjs-loader');
const {
  configure: configureJestTransform,
  handles: jestHandles,
  installExtensions: installJestExtensions,
} = require('./jest-transform');
const {
  configure: configureResolution,
  mapToFile,
  resolveAlias,
  resolveFile,
  sourceFile,
  parentDir,
} = require('./resolve-paths');
const {
  configure: configureTransform,
  needsTransform,
  transform,
  transformerName,
  isAsset,
  assetSource,
  isJson,
  jsonSource,
  assetExtensions,
  assetExports,
} = require('./transform');

// Test files that call vi.mock() / jest.mock() get it hoisted; checked on the source, before loading them. Those
// that only call jest.doMock() or jest.dontMock() (not hoisted) need the mocking hooks too.
const MOCK_CALL = /\b(?:vi|jest)\s*\.\s*(?:mock|unmock|hoisted|doMock|doUnmock|dontMock|deepUnmock)\s*\(/;

// Only vyntra's runtime stays loaded between files; vyntra's own tests are isolated like any other project files.
const RUNTIME_DIR = `${__dirname}${path.sep}`;
const RUNTIME_URL = `${pathToFileURL(__dirname).href}/`;
const ENTRY_CJS = path.join(__dirname, 'index.js');
const ENTRY_ESM = pathToFileURL(path.join(__dirname, 'index.mjs')).href;
const NODE_MODULES = `${path.sep}node_modules${path.sep}`;

// Imports of other test frameworks resolve to vyntra, so their test files run unchanged.
const ALIASES = new Set(['vyntra', 'vitest', 'vitest/globals', '@jest/globals', '@vitest/expect']);

const hooked = { cjs: false, esm: false };

// require() of a stylesheet or an image, which a bundler also answers. Node has no loader for the
// extension and throws before the module that asked for it runs a line.
function installAssetExtensions() {
  assetExtensions()
    .filter((ext) => !Module._extensions[ext])
    .forEach((ext) => {
      Module._extensions[ext] = (module, filename) => {
        module.exports = assetExports(filename);
      };
    });
}

function hookCjs() {
  if (hooked.cjs) {
    return;
  }
  hooked.cjs = true;
  // The one CommonJS resolution hook Node.js has.
  const resolveFilename = Module._resolveFilename;
  Module._resolveFilename = function vyntraResolveFilename(request, parent, ...rest) {
    if (ALIASES.has(request)) {
      return ENTRY_CJS;
    }
    const from = parent?.filename ? path.dirname(parent.filename) : undefined;
    const target = resolveAlias(request, from ?? process.cwd()) ?? request;
    const mapped = mapToFile(target, from ?? process.cwd());
    try {
      return resolveFilename.call(this, mapped ?? target, parent, ...rest);
    } catch (error) {
      // CommonJS already tries its own extensions; this adds the ones a bundler
      // would, which is how a TypeScript file reached from JavaScript is found.
      const file = resolveFile(request, from ?? process.cwd());
      if (file) {
        return file;
      }
      throw error;
    }
  };
  installAssetExtensions();
  installCjsLoader();
}

// ES modules can not be evicted from the cache, so each test file imports its own copy of the project modules,
// told apart by a query string. Dependencies in node_modules are shared.
let isolatedDependencies = [];

function isIsolatedDependency(location) {
  return isolatedDependencies.some((name) => location.includes(`${path.sep}node_modules${path.sep}${name}${path.sep}`));
}

function isolatedUrl(url, conditions) {
  const isolated =
    url.startsWith('file:') &&
    !url.startsWith(RUNTIME_URL) &&
    !url.includes('vyntra=') &&
    (!url.includes('/node_modules/') || isIsolatedDependency(fileURLToPath(url)));
  if (!isolated || state.generation === 0 || !conditions.includes('import')) {
    return url;
  }
  return `${url}${url.includes('?') ? '&' : '?'}vyntra=${state.generation}`;
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

// Node names the exports of a CommonJS module by reading its source, which misses any that a bundle
// assigns at run time (lodash, UMD builds), so `import { throttle } from 'lodash'` fails to link.
// Bundlers and vitest name them from module.exports itself; this does the same.
function commonJsInterop(file) {
  const exported = Module.createRequire(file)(file);
  const names =
    exported !== null && (typeof exported === 'object' || typeof exported === 'function')
      ? Object.keys(exported).filter((name) => name !== 'default' && IDENTIFIER.test(name))
      : [];
  return [
    `import { createRequire } from 'node:module';`,
    `const exported = createRequire(${JSON.stringify(file)})(${JSON.stringify(file)});`,
    // A module compiled from ESM marks itself __esModule and keeps its default export on `.default`.
    `export default exported?.__esModule && 'default' in exported ? exported.default : exported;`,
    // Through an export list, which takes any name: express exports `static`, which a declaration can not be named.
    ...names.map((name, i) => `const e${i} = exported[${JSON.stringify(name)}];`),
    names.length > 0 ? `export { ${names.map((name, i) => `e${i} as ${name}`).join(', ')} };` : '',
  ].join('\n');
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

// The format Node gives a file of a package by its extension and the package's "type".
function formatOf(file) {
  const ext = path.extname(file);
  if (ext === '.mjs') {
    return 'module';
  }
  if (ext === '.cjs') {
    return 'commonjs';
  }
  if (ext === '.json') {
    return 'json';
  }
  return packageType(path.dirname(file));
}

// What the next load hook gives, or, where it gives a CommonJS module without its source, the file read here. Yarn's
// Plug'n'Play loader does: it leaves CommonJS to require(), which reads in its zip archives, but hooks registered
// with module.registerHooks must return the source, and Node throws. fs reads the archives, as PnP patches it.
function loadOrRead(url, file, context, nextLoad) {
  try {
    return nextLoad(url, context);
  } catch (error) {
    if (error?.code !== 'ERR_INVALID_RETURN_PROPERTY_VALUE') {
      throw error;
    }
    return { format: formatOf(file), source: fs.readFileSync(file, 'utf8'), shortCircuit: true };
  }
}

const ESM_SYNTAX = /^\s*(?:import\s|export\s|import\s*\{|export\s*\{)/m;
const esmSyntax = new Map();

function hasEsmSyntax(file) {
  if (!esmSyntax.has(file)) {
    try {
      esmSyntax.set(file, ESM_SYNTAX.test(fs.readFileSync(file, 'utf8')));
    } catch {
      esmSyntax.set(file, false);
    }
  }
  return esmSyntax.get(file);
}

// A file of the project, in a package with no "type", written as an ES module: loaded as one. Node would parse it as
// CommonJS first, then again, and warn about it (MODULE_TYPELESS_PACKAGE_JSON) for every test file; vitest never
// shows that warning. Null for any other file, which Node loads.
function typelessModule(file) {
  const ext = path.extname(file);
  if (
    (ext !== '.ts' && ext !== '.js') ||
    file.includes(NODE_MODULES) ||
    nearestType(path.dirname(file)) !== undefined
  ) {
    return null;
  }
  if (!hasEsmSyntax(file)) {
    return null;
  }
  return {
    format: ext === '.ts' ? 'module-typescript' : 'module',
    source: fs.readFileSync(file, 'utf8'),
    shortCircuit: true,
  };
}

const resolutions = new Map();

function hookEsm(config) {
  if (hooked.esm || typeof Module.registerHooks !== 'function') {
    return;
  }
  hooked.esm = true;
  // From now on CommonJS sources go through these hooks too, which only Node's own loader runs.
  state.loaderHooks = true;
  const isolate = config.isolate !== false;
  Module.registerHooks({
    resolve(specifier, context, nextResolve) {
      if (ALIASES.has(specifier)) {
        const url = context.conditions.includes('require') ? pathToFileURL(ENTRY_CJS).href : ENTRY_ESM;
        return { url, shortCircuit: true };
      }
      const from = parentDir(context.parentURL);
      const target = resolveAlias(specifier, from) ?? specifier;
      const mapped = path.isAbsolute(target) ? target : (mapToFile(target, from) ?? sourceFile(target, from));
      const request = mapped ? pathToFileURL(mapped).href : target;
      // Where a specifier leads from a directory does not change during a run, and Node resolves it again (file
      // probes, package.json exports and scope) for every test file, which imports the project afresh. Specifiers
      // with a query (a mock's real module, ?raw) are left to Node.
      const cacheable = !/^(?:node:|data:)/.test(request) && !/[?#]/.test(request);
      const key = cacheable ? `${request}\0${from}\0${context.conditions.join(',')}` : null;
      let result = key ? resolutions.get(key) : undefined;
      if (result) {
        const url = isolate ? isolatedUrl(result.url, context.conditions) : result.url;
        return { ...result, url, shortCircuit: true };
      }
      try {
        result = nextResolve(request, context);
        if (key) {
          resolutions.set(key, result);
        }
      } catch (error) {
        // Node names no file for "./Language" or "../lib/util"; a bundler would.
        const file = resolveFile(request, from);
        if (!file) {
          throw error;
        }
        result = nextResolve(pathToFileURL(file).href, context);
      }
      return isolate ? { ...result, url: isolatedUrl(result.url, context.conditions) } : result;
    },
    load(url, context, nextLoad) {
      if (!url.startsWith('file:')) {
        return nextLoad(url, context);
      }
      let file;
      try {
        file = fileURLToPath(url);
      } catch {
        return nextLoad(url, context);
      }
      if (isJson(file)) {
        // Only an import without attributes gets an ES module of it, as in vitest, which needs no { type: 'json' }.
        // Everything else is loaded as JSON, which require() takes as module.exports (an ES module of it has none): a
        // require() (with the condition "require") and a require() in CommonJS that an ES module imported, which
        // Node loads as an import with { type: 'json' }.
        const isRequire = context.conditions?.includes('require');
        if (isRequire || context.importAttributes?.type === 'json') {
          return { format: 'json', source: fs.readFileSync(file, 'utf8'), shortCircuit: true };
        }
        return { format: 'module', source: jsonSource(file), shortCircuit: true };
      }
      if (isAsset(file)) {
        return { format: 'module', source: assetSource(file), shortCircuit: true };
      }
      if (!needsTransform(file)) {
        const loaded = typelessModule(file) ?? loadOrRead(url, file, context, nextLoad);
        if (loaded.format === 'module' && isSpyable(file)) {
          return { format: 'module', source: makeSpyable(String(loaded.source), url), shortCircuit: true };
        }
        return loaded.format === 'commonjs' && file.includes(NODE_MODULES) && context.conditions.includes('import')
          ? { format: 'module', source: commonJsInterop(file), shortCircuit: true }
          : loaded;
      }
      const source = transform(fs.readFileSync(file, 'utf8'), file);
      if (source === null) {
        return nextLoad(url, context);
      }
      // Node has no format for .tsx or .jsx and would refuse the file; the transform leaves ES modules.
      return { format: 'module', source: isSpyable(file) ? makeSpyable(source, url) : source, shortCircuit: true };
    },
  });
}

function isEsm(file) {
  // A Jest transformer compiles to CommonJS, which require() loads, as under Jest.
  if (jestHandles(file)) {
    return false;
  }
  const ext = path.extname(file);
  if (ext === '.mjs' || ext === '.mts') {
    return true;
  }
  // The transform leaves ES modules, and only the ESM loader runs it.
  if (ext === '.tsx' || ext === '.jsx') {
    return true;
  }
  if (ext === '.cjs' || ext === '.cts') {
    return false;
  }
  // A file the transformer compiles leaves ES modules whatever the package says, and only the ESM
  // loader runs the transform. Requiring it would also refuse a setup file with a top-level await.
  if (needsTransform(file)) {
    return true;
  }
  if (packageType(path.dirname(file)) === 'module') {
    return true;
  }
  // Node loads a file with import syntax as an ES module even where the package says CommonJS, but
  // through require(), which leaves its imports to a resolver the hooks never installed.
  return hasEsmSyntax(file);
}

function checkSupported(file) {
  const ext = path.extname(file);
  if (/^\.[cm]?ts$/.test(ext) && !process.features.typescript) {
    throw new Error(`Can not run ${file}: TypeScript needs Node.js 22.18 or later (or --experimental-strip-types)`);
  }
  if ((ext === '.tsx' || ext === '.jsx') && !transformerName()) {
    throw new Error(
      `Can not run ${file}: JSX needs esbuild, sucrase or typescript in the project, and none is installed`
    );
  }
}

// Loads a test or setup file. `fresh` evaluates it again even when it is cached (setup files run for every file).
async function loadModule(file, config, fresh) {
  isolatedDependencies = (config.isolateDependencies ?? []).map((name) => name.split('/').join(path.sep));
  configureResolution(config);
  configureTransform(config);
  configureJestTransform(config);
  installJestExtensions();
  hookCjs();
  checkSupported(file);
  const source = fs.readFileSync(file, 'utf8');
  // eslint-disable-next-line global-require -- read the registry only once a file loads
  markSpyable(file, source, require('./modules/registry').resolveKey);
  if (MOCK_CALL.test(source)) {
    // eslint-disable-next-line global-require -- the mocking hooks are only loaded by the files that mock
    require('./modules/hooks').enableMocking(file, isEsm(file));
  }
  if (isEsm(file)) {
    hookEsm(config);
    const version = fresh || config.isolate !== false ? `?vyntra=${state.generation}` : '';
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
    .filter((key) => (!key.includes(NODE_MODULES) || isIsolatedDependency(key)) && !key.startsWith(RUNTIME_DIR))
    .forEach((key) => {
      delete require.cache[key];
    });
}

// Forgets modules a file leaves changed (see ModuleMocks.stale()), whether in node_modules or not.
function forgetModules(keys) {
  keys
    // vyntra's runtime stays, and so do native addons: loaded once per process, they can not be loaded again.
    .filter((key) => !key.startsWith(RUNTIME_DIR) && !key.endsWith('.node'))
    .forEach((key) => {
      delete require.cache[key];
    });
}

module.exports = { loadModule, isolateModules, forgetModules, isEsm, hookCjs, ALIASES };
