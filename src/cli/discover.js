const fs = require('node:fs');
const path = require('node:path');
const { globToRegExp } = require('./glob');

const toPosix = (file) => file.split(path.sep).join('/');

// Walks the tree from root, without entering the excluded directories, and returns the files include matches.
function walk(root, include, exclude) {
  const files = [];
  const pending = [root];
  while (pending.length > 0) {
    const dir = pending.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      entries = [];
    }
    entries.forEach((entry) => {
      const full = path.join(dir, entry.name);
      const relative = toPosix(path.relative(root, full));
      if (exclude.some((regex) => regex.test(relative) || regex.test(`${relative}/`))) {
        return;
      }
      if (entry.isDirectory()) {
        pending.push(full);
      } else if (entry.isFile() && include.some((regex) => regex.test(relative))) {
        files.push(full);
      }
    });
  }
  return files.sort();
}

// Positional CLI arguments filter the files like Jest's testPathPattern: a regex matched against the path.
function filterByPatterns(files, root, patterns) {
  if (patterns.length === 0) {
    return files;
  }
  const regexes = patterns.map((pattern) => {
    try {
      return new RegExp(pattern);
    } catch {
      return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    }
  });
  return files.filter((file) => {
    const relative = toPosix(path.relative(root, file));
    const absolute = toPosix(file);
    return regexes.some((regex) => regex.test(relative) || regex.test(absolute));
  });
}

const isFile = (file) => {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
};

function discover(config, patterns = []) {
  const include = config.include.map(globToRegExp);
  const exclude = config.exclude.map(globToRegExp);
  const ignore = config.excludePatterns.map((pattern) => new RegExp(pattern));
  // Files named one by one (an editor, a CI shard) are taken as they are, without walking the project.
  const named = patterns.map((pattern) => path.resolve(config.rootDir, pattern));
  if (named.length > 0 && named.every(isFile)) {
    return [...new Set(named)].filter((file) => {
      const relative = toPosix(path.relative(config.rootDir, file));
      return (
        include.some((regex) => regex.test(relative)) &&
        !exclude.some((regex) => regex.test(relative)) &&
        !ignore.some((regex) => regex.test(toPosix(file)))
      );
    });
  }
  const files = config.roots
    .flatMap((root) => walk(path.resolve(config.rootDir, root), include, exclude))
    .filter((file) => !ignore.some((regex) => regex.test(toPosix(file))));
  return filterByPatterns([...new Set(files)], config.rootDir, patterns);
}

module.exports = { discover };
