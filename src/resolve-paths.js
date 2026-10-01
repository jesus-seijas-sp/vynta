const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');

// Bundlers resolve an import that names no file ("./Language", "src/lib/util") by trying a list
// of extensions and then an index file, and by rewriting configured prefixes. Node does neither in
// ES modules, so a project written for Vite, webpack or Jest does not load unchanged. Both steps
// run only after Node's own resolution has failed, so an import that already works is untouched.

let mappings = [];
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
  resolved.clear();
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

function isFile(candidate) {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function probe(filePath) {
  if (isFile(filePath)) {
    return filePath;
  }
  const withExtension = extensions.map((ext) => filePath + ext).find(isFile);
  return withExtension ?? extensions.map((ext) => path.join(filePath, `index${ext}`)).find(isFile) ?? null;
}

function readManifest(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
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

module.exports = { configure, mapSpecifier, mapToFile, resolveFile, parentDir };
