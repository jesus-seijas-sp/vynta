const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');

// Bundlers resolve an import that names no file ("./Language", "src/lib/util") by trying a list
// of extensions and then an index file, and by rewriting configured prefixes. Node does neither in
// ES modules, so a project written for Vite, webpack or Jest does not load unchanged. Both steps
// run only after Node's own resolution has failed, so an import that already works is untouched.

let mappings = [];
let aliases = [];
let extensions = [];
let rootDir = process.cwd();
const resolved = new Map();

function configure(config = {}) {
  rootDir = config.rootDir ?? process.cwd();
  extensions = (config.moduleFileExtensions ?? []).map((ext) => (ext.startsWith('.') ? ext : `.${ext}`));
  mappings = Object.entries(config.moduleNameMapper ?? {}).map(([pattern, target]) => ({
    pattern: new RegExp(pattern),
    targets: Array.isArray(target) ? target : [target],
  }));
  aliases = config.alias ?? [];
  resolved.clear();
}

// Vite's alias ([{ find, replacement }], from a vitest config): a string matches the specifier or its subpaths
// ('@app' matches '@app' and '@app/x'), a regular expression is replaced as String.replace does. The specifier the
// first matching alias makes, or null.
function applyAlias(specifier) {
  for (let i = 0; i < aliases.length; i += 1) {
    const { find, replacement } = aliases[i];
    if (find instanceof RegExp) {
      find.lastIndex = 0;
      if (find.test(specifier)) {
        return specifier.replace(find, replacement);
      }
    } else if (specifier === find || specifier.startsWith(`${find}/`)) {
      return replacement + specifier.slice(find.length);
    }
  }
  return null;
}

// Jest's moduleNameMapper: the first pattern that matches replaces the specifier, with <rootDir>
// and the pattern's capture groups filled in. An array of targets is tried in order.
function mapSpecifier(specifier) {
  const mapping = mappings.find(({ pattern }) => pattern.test(specifier));
  if (!mapping) {
    return null;
  }
  const match = mapping.pattern.exec(specifier);
  return mapping.targets.map((target) =>
    target.replaceAll('<rootDir>', rootDir).replace(/\$(\d)/g, (_, group) => match[group] ?? '')
  );
}

// Files and manifests do not change during a run, and resolution asks about the same ones over and over.
const files = new Map();
const manifests = new Map();

function isFile(candidate) {
  if (!files.has(candidate)) {
    let found = false;
    try {
      found = fs.statSync(candidate).isFile();
    } catch {
      found = false;
    }
    files.set(candidate, found);
  }
  return files.get(candidate);
}

// TypeScript has an import name the file it compiles to ('./injector.js' for injector.ts): where only the source is
// there, that is the file meant.
const SOURCE_OF = { '.js': ['.ts', '.tsx'], '.mjs': ['.mts'], '.cjs': ['.cts'], '.jsx': ['.tsx'] };

function probe(filePath) {
  if (isFile(filePath)) {
    return filePath;
  }
  const compiledExt = path.extname(filePath);
  const source = SOURCE_OF[compiledExt]
    ?.map((sourceExt) => filePath.slice(0, -compiledExt.length) + sourceExt)
    .find(isFile);
  if (source) {
    return source;
  }
  const withExtension = extensions.map((ext) => filePath + ext).find(isFile);
  return withExtension ?? extensions.map((ext) => path.join(filePath, `index${ext}`)).find(isFile) ?? null;
}

function readManifest(file) {
  if (!manifests.has(file)) {
    let manifest = null;
    try {
      manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      manifest = null;
    }
    manifests.set(file, manifest);
  }
  return manifests.get(file);
}

// "pkg/sub/path" into a package with no "exports": bundlers probe it like a relative path, while
// Node's ES module resolution demands the exact file. A package that declares exports is left to Node.
function probePackageSubpath(specifier, fromDir) {
  const parts = specifier.split('/');
  const nameLength = specifier.startsWith('@') ? 2 : 1;
  if (parts.length <= nameLength || specifier.startsWith('node:')) {
    return null;
  }
  const name = parts.slice(0, nameLength).join('/');
  const subpath = parts.slice(nameLength).join('/');
  for (let dir = fromDir; ; dir = path.dirname(dir)) {
    const packageDir = path.join(dir, 'node_modules', name);
    const manifest = readManifest(path.join(packageDir, 'package.json'));
    if (manifest) {
      return manifest.exports ? null : probe(path.join(packageDir, subpath));
    }
    if (path.dirname(dir) === dir) {
      return null;
    }
  }
}

// The conditions Node matches when it imports a package, in its order of preference.
const IMPORT_CONDITIONS = new Set(['node', 'import', 'module-sync', 'default']);

// The path an "exports" target gives under those conditions (the first matching key wins, as in Node).
function exportTarget(target) {
  if (typeof target === 'string') {
    return target;
  }
  if (Array.isArray(target)) {
    return target.map(exportTarget).find(Boolean) ?? null;
  }
  if (target && typeof target === 'object') {
    const key = Object.keys(target).find((condition) => IMPORT_CONDITIONS.has(condition));
    return key ? exportTarget(target[key]) : null;
  }
  return null;
}

// The target of a subpath in an exports map: its own key, or else the pattern ('./dist/*') with the
// longest prefix that matches, its '*' filled in, as Node resolves it.
function exportedPath(exportsMap, subpath) {
  if (subpath in exportsMap) {
    return exportTarget(exportsMap[subpath]);
  }
  const pattern = Object.keys(exportsMap)
    .filter((key) => {
      const [prefix, suffix = ''] = key.split('*');
      return (
        key.includes('*') && subpath.startsWith(prefix) && subpath.endsWith(suffix) && subpath.length >= key.length - 1
      );
    })
    .sort((a, b) => b.indexOf('*') - a.indexOf('*'))[0];
  if (!pattern) {
    return null;
  }
  const [prefix, suffix = ''] = pattern.split('*');
  const star = subpath.slice(prefix.length, subpath.length - suffix.length);
  return exportTarget(exportsMap[pattern])?.replaceAll('*', star) ?? null;
}

// The file `import 'pkg'` loads, which for a package shipping both builds is not the one require()
// resolves to. A mock built from the other build would share no state with the code under test.
function resolveImportFile(specifier, fromDir) {
  const parts = specifier.split('/');
  const nameLength = specifier.startsWith('@') ? 2 : 1;
  const name = parts.slice(0, nameLength).join('/');
  const subpath = parts.slice(nameLength).join('/');
  for (let dir = fromDir; ; dir = path.dirname(dir)) {
    const packageDir = path.join(dir, 'node_modules', name);
    const manifest = readManifest(path.join(packageDir, 'package.json'));
    if (manifest) {
      const { exports } = manifest;
      if (!exports) {
        return null;
      }
      const sugar = typeof exports === 'string' || Array.isArray(exports) || !Object.keys(exports)[0]?.startsWith('.');
      const target = exportedPath(sugar ? { '.': exports } : exports, subpath ? `./${subpath}` : '.');
      return target ? probe(path.join(packageDir, target)) : null;
    }
    if (path.dirname(dir) === dir) {
      return null;
    }
  }
}

// The file a specifier names, or null when it names none and Node should answer.
function resolveFile(specifier, fromDir) {
  const key = `${fromDir} ${specifier}`;
  if (resolved.has(key)) {
    return resolved.get(key);
  }
  let file = null;
  if (specifier.startsWith('file:')) {
    try {
      file = probe(fileURLToPath(specifier));
    } catch {
      file = null;
    }
  } else if (path.isAbsolute(specifier)) {
    file = probe(specifier);
  } else if (specifier.startsWith('.')) {
    file = probe(path.resolve(fromDir, specifier));
  } else {
    file = probePackageSubpath(specifier, fromDir);
  }
  resolved.set(key, file);
  return file;
}

// Where an alias sends a specifier: the file it names (found as a bundler finds one: extensions, index, .js for
// .ts), or the specifier it becomes when it names a package; null when no alias matches.
function resolveAlias(specifier, fromDir) {
  const aliased = applyAlias(specifier);
  if (aliased === null || !(path.isAbsolute(aliased) || aliased.startsWith('.'))) {
    return aliased;
  }
  const file = path.resolve(rootDir, aliased);
  return resolveFile(file, fromDir) ?? file;
}

// The TypeScript source a relative import names by its compiled file ('./injector.js' for injector.ts), when only the
// source is there; null otherwise. Asked before Node resolves: Node failing on the missing file first costs a
// CommonJS resolution of it too, done only to word the error, for every import of every test file.
function sourceFile(specifier, fromDir) {
  if (!/^\.\.?\//.test(specifier) || !SOURCE_OF[path.extname(specifier)]) {
    return null;
  }
  const file = path.resolve(fromDir, specifier);
  return isFile(file) ? null : probe(file);
}

// The file a mapping rewrites the specifier to, or null when none matches or none exists.
function mapToFile(specifier, fromDir) {
  const targets = mapSpecifier(specifier);
  if (!targets) {
    return null;
  }
  return targets.map((target) => resolveFile(target, fromDir)).find(Boolean) ?? null;
}

function parentDir(parentURL) {
  if (!parentURL) {
    return rootDir;
  }
  try {
    return path.dirname(fileURLToPath(parentURL));
  } catch {
    return rootDir;
  }
}

module.exports = {
  configure,
  applyAlias,
  resolveAlias,
  mapSpecifier,
  mapToFile,
  resolveFile,
  resolveImportFile,
  sourceFile,
  parentDir,
};
