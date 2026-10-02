const crypto = require('node:crypto');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const { readCompiled, writeCompiled } = require('./transform');

// Jest's `transform`: the project's own transformers (babel-jest, ts-jest, @swc/jest, a script of its own) compile
// the files they match into CommonJS, which then loads through require(), as under Jest. A project that names one
// gets exactly what Jest would run; one that names none is left to vyntra's own handling.

// Jest's default transformIgnorePatterns.
const DEFAULT_IGNORE = ['/node_modules/', '\\.pnp\\.[^\\/]+$'];

// Jest writes its patterns with "/" and matches them against Windows paths, which have "\": its
// replacePathSepForRegex turns every separator of the pattern (but escaped characters) into one that matches "\".
function forPaths(pattern) {
  if (path.sep !== '\\') {
    return new RegExp(pattern);
  }
  return new RegExp(
    pattern.replace(/(\/|(.)?\\(?![[\]{}()*+?.^$|\\]))/g, (match, _, previous) =>
      previous && previous !== '\\' ? `${previous}\\\\` : '\\\\'
    )
  );
}

let rules = [];
let ignored = [];
let rootDir = process.cwd();
let configured = '';
const instances = new Map();
let loadingTransformer = 0;
const compiled = new Map();

function configure(config = {}) {
  const key = JSON.stringify([config.rootDir, config.jestTransform, config.transformIgnorePatterns]);
  if (key === configured) {
    return;
  }
  configured = key;
  rootDir = config.rootDir ?? process.cwd();
  const { resolve } = Module.createRequire(path.join(rootDir, 'package.json'));
  rules = Object.entries(config.jestTransform ?? {}).map(([pattern, value]) => {
    const [name, options = {}] = [value].flat();
    const file = path.isAbsolute(name) ? name : resolve(name.replaceAll('<rootDir>', rootDir));
    return { pattern: forPaths(pattern), file, options };
  });
  ignored = (config.transformIgnorePatterns ?? DEFAULT_IGNORE).map((pattern) =>
    forPaths(pattern.replaceAll('<rootDir>', rootDir))
  );
  compiled.clear();
}

// The transformer a rule names, made once per thread: a module with createTransformer gets its options through it.
function transformerOf(rule) {
  const id = `${rule.file}\0${JSON.stringify(rule.options)}`;
  if (!instances.has(id)) {
    // As Jest does, the transformer and what it requires load as they are: matched by its own pattern (a .js
    // transformer for .js files), it would be asked to compile itself while it loads.
    loadingTransformer += 1;
    let loaded;
    try {
      // eslint-disable-next-line global-require -- the project's transformer, loaded when a file needs it
      loaded = require(rule.file);
    } finally {
      loadingTransformer -= 1;
    }
    // A transformer written as an ES module and compiled to CommonJS keeps itself on .default.
    // eslint-disable-next-line no-underscore-dangle -- the marker's name
    const module = loaded?.__esModule && loaded.default ? loaded.default : loaded;
    const transformer =
      typeof module.createTransformer === 'function' ? module.createTransformer(rule.options) : module;
    if (typeof transformer?.then === 'function' || typeof transformer?.process !== 'function') {
      throw new Error(`The Jest transformer ${rule.file} has no synchronous process(): vyntra can not run it`);
    }
    instances.set(id, { transformer, version: fs.statSync(rule.file).mtimeMs });
  }
  return instances.get(id);
}

// The rule that compiles a file, or null.
function ruleFor(filename) {
  if (rules.length === 0 || loadingTransformer > 0 || ignored.some((pattern) => pattern.test(filename))) {
    return null;
  }
  return rules.find(({ pattern }) => pattern.test(filename)) ?? null;
}

const handles = (filename) => ruleFor(filename) !== null;

function transformOptions(rule) {
  return {
    config: { rootDir, cwd: rootDir, transformIgnorePatterns: [], moduleFileExtensions: ['js', 'ts', 'tsx'] },
    configString: JSON.stringify({ rootDir }),
    transformerConfig: rule.options,
    cacheFS: new Map(),
    instrument: false,
    supportsDynamicImport: true,
    supportsExportNamespaceFrom: true,
    supportsStaticESM: false,
    supportsTopLevelAwait: false,
  };
}

// The code the project's transformer makes of a file, kept in memory for the thread and on disk between runs (under
// the transformer's own cache key, when it has one). Null when no transformer is configured for the file.
function transformWithJest(source, filename) {
  const rule = ruleFor(filename);
  if (!rule) {
    return null;
  }
  const kept = compiled.get(filename);
  if (kept?.source === source) {
    return kept.code;
  }
  const { transformer, version } = transformerOf(rule);
  const options = transformOptions(rule);
  const own = transformer.getCacheKey?.(source, filename, options) ?? source;
  const key = crypto.createHash('sha1').update(`jest\0${rule.file}\0${version}\0${filename}\0${own}`).digest('hex');
  let code = readCompiled(key);
  if (code === null) {
    const result = transformer.process(source, filename, options);
    code = typeof result === 'string' ? result : result.code;
    writeCompiled(key, code);
  }
  compiled.set(filename, { source, code });
  return code;
}

// Compiles a file with its transformer and runs it as the CommonJS module Jest would load.
function compileWithJest(module, filename) {
  return module._compile(transformWithJest(fs.readFileSync(filename, 'utf8'), filename), filename, 'commonjs');
}

// require() of the extensions transformers compile, besides .js (see cjs-loader.js). Only for projects that name a
// transformer: a handler is also an extension require() tries, which would change what other projects resolve to.
let installed = false;

function installExtensions() {
  if (installed || rules.length === 0) {
    return;
  }
  installed = true;
  ['.ts', '.tsx', '.cts', '.jsx'].forEach((ext) => {
    const original = Module._extensions[ext];
    Module._extensions[ext] = function vyntraJestTransform(module, filename) {
      if (handles(filename)) {
        return compileWithJest(module, filename);
      }
      return (original ?? Module._extensions['.js']).call(this, module, filename);
    };
  });
}

module.exports = { configure, handles, transformWithJest, compileWithJest, installExtensions };
