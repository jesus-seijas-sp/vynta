const fs = require('node:fs');
const path = require('node:path');

// The order a file's mocks are prepared in. Preparing an automock, or a factory that may call
// importOriginal(), imports the real module, and any mock that module reaches must be ready first:
// the ES module hooks can not wait for it then. vitest prepares mocks lazily and never meets this.
// The order comes from the import graph of the real modules, read statically through the project's
// files (dependencies in node_modules are not followed), and cached for the thread.

const IMPORTS =
  /\bfrom\s*['"]([^'"\n]+)['"]|\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)|\bimport\s+['"]([^'"\n]+)['"]|\brequire\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g;
const NODE_MODULES = `${path.sep}node_modules${path.sep}`;
const specifiers = new Map();

const isProjectFile = (key) => path.isAbsolute(key) && !key.includes(NODE_MODULES);

function specifiersOf(file) {
  if (!specifiers.has(file)) {
    let source = '';
    try {
      source = fs.readFileSync(file, 'utf8');
    } catch {
      // A file that can not be read imports nothing we can follow.
    }
    specifiers.set(
      file,
      [...source.matchAll(IMPORTS)].map((match) => match[1] ?? match[2] ?? match[3] ?? match[4])
    );
  }
  return specifiers.get(file);
}

// The mocks the import graph of a module reaches.
function mocksReached(start, lookup, resolve) {
  const reached = new Set();
  const seen = new Set([start]);
  const pending = [start];
  while (pending.length > 0) {
    const file = pending.pop();
    specifiersOf(file).forEach((specifier) => {
      const key = resolve(specifier, file);
      const entry = lookup(key, specifier);
      if (entry) {
        reached.add(entry);
      } else if (isProjectFile(key) && !seen.has(key)) {
        seen.add(key);
        pending.push(key);
      }
    });
  }
  return reached;
}

// The entries, each after the mocks its real module imports. A cycle between mocks is left in place:
// the hooks serve the original to a module importing a mock whose factory is still running.
function orderMocks(entries, lookup, resolve) {
  const ordered = [];
  const visited = new Set();
  const visit = (entry) => {
    if (visited.has(entry)) {
      return;
    }
    visited.add(entry);
    const importsReal = !entry.factory || entry.factory.constructor.name === 'AsyncFunction';
    if (importsReal && isProjectFile(entry.key)) {
      mocksReached(entry.key, lookup, resolve).forEach((dependency) => visit(dependency));
    }
    ordered.push(entry);
  };
  entries.forEach(visit);
  return ordered;
}

const packageOf = (specifier) =>
  specifier
    .split('/')
    .slice(0, specifier.startsWith('@') ? 2 : 1)
    .join('/');

// The packages a set of files imports, directly or through the project's other files.
function packagesReached(starts, resolve) {
  const packages = new Set();
  const seen = new Set(starts);
  const pending = [...starts];
  while (pending.length > 0) {
    const file = pending.pop();
    specifiersOf(file).forEach((specifier) => {
      if (!specifier.startsWith('.') && !path.isAbsolute(specifier) && !specifier.startsWith('node:')) {
        packages.add(packageOf(specifier));
      }
      const key = resolve(specifier, file);
      if (isProjectFile(key) && !seen.has(key)) {
        seen.add(key);
        pending.push(key);
      }
    });
  }
  return packages;
}

module.exports = { orderMocks, packagesReached };
