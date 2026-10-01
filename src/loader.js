const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { pathToFileURL, fileURLToPath } = require('node:url');
const state = require('./state');
const { configure: configureResolution, mapToFile, resolveFile, parentDir } = require('./resolve-paths');
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
  Module._resolveFilename = function vyntaResolveFilename(request, parent, ...rest) {
    if (ALIASES.has(request)) {
      return ENTRY_CJS;
    }
    const from = parent?.filename ? path.dirname(parent.filename) : undefined;
    const mapped = mapToFile(request, from ?? process.cwd());
    try {
      return resolveFilename.call(this, mapped ?? request, parent, ...rest);
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
    !url.includes('vynta=') &&
    (!url.includes('/node_modules/') || isIsolatedDependency(fileURLToPath(url)));
  if (!isolated || state.generation === 0 || !conditions.includes('import')) {
    return url;
  }
  return `${url}${url.includes('?') ? '&' : '?'}vynta=${state.generation}`;
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
    ...names.map((name) => `export const ${name} = exported[${JSON.stringify(name)}];`),
  ].join('\n');
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
      const from = parentDir(context.parentURL);
      const mapped = mapToFile(specifier, from);
      const request = mapped ? pathToFileURL(mapped).href : specifier;
      let result;
      try {
        result = nextResolve(request, context);
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
        return { format: 'module', source: jsonSource(file), shortCircuit: true };
      }
      if (isAsset(file)) {
        return { format: 'module', source: assetSource(file), shortCircuit: true };
      }
      if (!needsTransform(file)) {
        const loaded = nextLoad(url, context);
        return loaded.format === 'commonjs' && file.includes(NODE_MODULES) && context.conditions.includes('import')
          ? { format: 'module', source: commonJsInterop(file), shortCircuit: true }
          : loaded;
      }
      const source = transform(fs.readFileSync(file, 'utf8'), file);
      if (source === null) {
        return nextLoad(url, context);
      }
      // Node has no format for .tsx or .jsx and would refuse the file; the transform leaves ES modules.
      return { format: 'module', source, shortCircuit: true };
    },
  });
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
    .filter((key) => (!key.includes(NODE_MODULES) || isIsolatedDependency(key)) && !key.startsWith(RUNTIME_DIR))
    .forEach((key) => {
      delete require.cache[key];
    });
}

module.exports = { loadModule, isolateModules, isEsm, hookCjs, ALIASES };
