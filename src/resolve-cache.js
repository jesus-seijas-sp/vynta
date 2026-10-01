const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const NODE_MODULES = `${path.sep}node_modules${path.sep}`;

// Files that change when the installed dependencies change: when any of them does, the cache is stale.
const DEPENDENCY_FILES = [
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb',
  'node_modules/.modules.yaml',
  'node_modules/.package-lock.json',
  'node_modules/.yarn-state.yml',
];

function mtime(file) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

// Identifies the installed dependencies (and the Node.js version, whose resolution rules could change).
function dependencyStamp(rootDir) {
  return [process.version, ...DEPENDENCY_FILES.map((file) => mtime(path.join(rootDir, file)))].join('|');
}

function cacheFile(rootDir) {
  return path.join(rootDir, 'node_modules', '.cache', 'vyntra', 'resolutions.json');
}

// Where require() found each module in node_modules, kept between runs. Resolving is most of the time spent loading
// a large dependency tree: every require() probes the file system (node_modules of every parent directory, every
// extension, package.json files), which is slow on Windows especially. The answers only change when the installed
// dependencies do, so they are reused until then. Files of the project are always resolved normally.
class ResolveCache {
  constructor(entries = {}) {
    this.entries = new Map(Object.entries(entries));
    this.added = {};
    // Resolutions to files of the project, for this thread only: each test file loads the project again, and
    // resolving costs Node a package.json lookup (is it the package naming itself?) and file probes every time.
    this.project = new Map();
  }

  static load({ file, stamp }) {
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      return new ResolveCache(saved.stamp === stamp ? saved.entries : {});
    } catch {
      return new ResolveCache();
    }
  }

  install() {
    const resolveFilename = Module._resolveFilename;
    const cache = this;
    Module._resolveFilename = function cachedResolveFilename(request, parent, isMain, options) {
      if (options || !parent?.filename) {
        return resolveFilename.call(this, request, parent, isMain, options);
      }
      const key = `${path.dirname(parent.filename)}\0${request}`;
      const cached = cache.entries.get(key) ?? cache.project.get(key);
      if (cached) {
        return cached;
      }
      const resolved = resolveFilename.call(this, request, parent, isMain, options);
      if (!path.isAbsolute(resolved)) {
        return resolved;
      }
      if (resolved.includes(NODE_MODULES)) {
        cache.entries.set(key, resolved);
        cache.added[key] = resolved;
      } else {
        cache.project.set(key, resolved);
      }
      return resolved;
    };
  }

  // Merges what the threads found and saves it, when there is something new or the cache was stale.
  static save({ file, stamp }, additions) {
    const found = additions.filter((added) => added && Object.keys(added).length > 0);
    if (found.length === 0) {
      return;
    }
    let entries = {};
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      entries = saved.stamp === stamp ? saved.entries : {};
    } catch {
      // No cache yet.
    }
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ stamp, entries: Object.assign(entries, ...found) }));
    } catch {
      // A read-only project: nothing to keep.
    }
  }
}

module.exports = { ResolveCache, dependencyStamp, cacheFile };
