const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const state = require('./state');
const { handles, compileWithJest } = require('./jest-transform');

const NODE_MODULES = `${path.sep}node_modules${path.sep}`;
const UNKNOWN = Symbol('unknown');

// The "type" of the nearest package.json, per directory: 'module', 'commonjs', undefined (no "type" field, or no
// package.json at all), or UNKNOWN when a package.json can not be read, which Node reports better than we would.
const types = new Map();

function readType(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')).type;
  } catch (error) {
    return error.code === 'ENOENT' ? null : UNKNOWN;
  }
}

function nearestType(dir) {
  if (!types.has(dir)) {
    const found = readType(path.join(dir, 'package.json'));
    const parent = path.dirname(dir);
    if (found !== null) {
      types.set(dir, found);
    } else {
      types.set(dir, parent === dir ? undefined : nearestType(parent));
    }
  }
  return types.get(dir);
}

// Sources of the project files, which every test file loads again (node_modules stay loaded). Kept with the size
// and modification time they had, so a file a test rewrites is read again.
const sources = new Map();

function sourceOf(filename) {
  const { size, mtimeMs } = fs.statSync(filename);
  const cached = sources.get(filename);
  if (cached?.size === size && cached.mtimeMs === mtimeMs) {
    return cached.source;
  }
  const source = fs.readFileSync(filename, 'utf8');
  sources.set(filename, { size, mtimeMs, source });
  return source;
}

// Node's loader of .js files looks for the nearest package.json, probing every parent directory, each time a module
// is loaded: thousands of probes for every thread loading a large dependency tree, slow on Windows especially. This
// one remembers the answer per directory, and keeps the sources of the project, which each test file loads again
// (node_modules are loaded once per thread). ES modules and loader hooks (which may change the source) are left to
// Node.
function installCjsLoader() {
  if (state.cjsLoader) {
    return;
  }
  state.cjsLoader = true;
  const loadJs = Module._extensions['.js'];
  Module._extensions['.js'] = function vyntraLoadJs(module, filename) {
    // A file the project's Jest transformer compiles, whatever loads it.
    if (handles(filename)) {
      return compileWithJest(module, filename);
    }
    if (state.loaderHooks || !filename.endsWith('.js')) {
      return loadJs.call(this, module, filename);
    }
    const type = nearestType(path.dirname(filename));
    if (type === 'module' || type === UNKNOWN) {
      return loadJs.call(this, module, filename);
    }
    const source = filename.includes(NODE_MODULES) ? fs.readFileSync(filename, 'utf8') : sourceOf(filename);
    // Node passes the "type" as the format: commonjs, or undefined to detect ES module syntax in the file.
    return module._compile(source, filename, type === 'commonjs' ? 'commonjs' : undefined);
  };
}

module.exports = { installCjsLoader, nearestType };
