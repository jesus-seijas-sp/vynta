const fs = require('node:fs');
const path = require('node:path');
const { globToRegExp } = require('./cli/glob');

// Vite answers `import.meta.glob('./x/*.ts')` with the files that match, each behind a function that
// imports it, and resolves the pattern while it builds. Node has nothing of the kind, so a module
// written for Vite throws "glob is not a function" before its first line runs. The call is replaced
// here with the object Vite would have produced, which is the one thing the caller reads.

// The type argument may nest its own angle brackets, as in <Record<string, unknown>>.
const CALL = /import\.meta\.glob\s*(?:<[^()]*>)?\s*\(/g;

// The text between the parentheses, respecting nesting and strings.
function callArguments(source, open) {
  let depth = 0;
  let quote = null;
  for (let i = open; i < source.length; i += 1) {
    const char = source[i];
    if (quote) {
      if (char === '\\') {
        i += 1;
      } else if (char === quote) {
        quote = null;
      }
    } else if (char === '"' || char === "'" || char === '`') {
      quote = char;
    } else if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
      if (depth === 0) {
        return { text: source.slice(open + 1, i), end: i + 1 };
      }
    }
  }
  return null;
}

function parsePatterns(text) {
  const patterns = [];
  const re = /(['"])((?:[^\\]|\\.)*?)\1/g;
  let match = re.exec(text);
  while (match && patterns.length === 0) {
    patterns.push(match[2]);
    match = re.exec(text);
  }
  const array = text.trimStart().startsWith('[');
  if (array) {
    patterns.length = 0;
    const all = text.slice(0, text.indexOf(']') + 1);
    const each = /(['"])((?:[^\\]|\\.)*?)\1/g;
    let one = each.exec(all);
    while (one) {
      patterns.push(one[2]);
      one = each.exec(all);
    }
  }
  return patterns;
}

const option = (text, name) => new RegExp(`${name}\\s*:\\s*(true|false|(['"])(.*?)\\2)`).exec(text);

function walk(dir, visit, depth = 0) {
  if (depth > 12) {
    return;
  }
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  entries
    .filter((entry) => entry.name !== 'node_modules' && !entry.name.startsWith('.'))
    .forEach((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, visit, depth + 1);
      } else {
        visit(full);
      }
    });
}

// Every file under `from` whose path matches one of the patterns, as the specifier Vite would key by.
function matches(patterns, from) {
  const found = new Set();
  const add = (file) => {
    const relative = path.relative(from, file).split(path.sep).join('/');
    found.add(relative.startsWith('.') ? relative : `./${relative}`);
  };
  patterns.forEach((pattern) => {
    const wildcard = pattern.search(/[*?[{]/);
    // A pattern naming one file ('../../main.tsx') is that file.
    if (wildcard === -1) {
      const file = path.resolve(from, pattern);
      if (fs.existsSync(file) && fs.statSync(file).isFile()) {
        add(file);
      }
      return;
    }
    // The walk starts at the last directory before the first wildcard, which may be above `from`.
    const prefix = pattern.slice(0, wildcard);
    const base = path.resolve(from, prefix.slice(0, prefix.lastIndexOf('/') + 1) || '.');
    const regexp = globToRegExp(path.resolve(from, pattern));
    walk(base, (file) => {
      if (regexp.test(file)) {
        add(file);
      }
    });
  });
  return [...found].sort();
}

function entrySource(specifier, from, { eager, importName, raw }) {
  if (raw) {
    let text = '';
    try {
      text = fs.readFileSync(path.resolve(from, specifier), 'utf8');
    } catch {
      text = '';
    }
    const value = JSON.stringify(importName === 'default' || eager ? text : { default: text });
    return `${JSON.stringify(specifier)}: ${eager ? value : `() => Promise.resolve(${value})`}`;
  }
  const load = `import(${JSON.stringify(specifier)})`;
  const picked =
    importName && importName !== '*' ? `${load}.then((module) => module[${JSON.stringify(importName)}])` : load;
  return `${JSON.stringify(specifier)}: ${eager ? `await ${picked}` : `() => ${picked}`}`;
}

// The source with every import.meta.glob() call replaced by the object it would have returned.
function expand(source, file) {
  if (!source.includes('import.meta.glob')) {
    return source;
  }
  const from = path.dirname(file);
  let out = '';
  let cursor = 0;
  CALL.lastIndex = 0;
  let call = CALL.exec(source);
  while (call) {
    const args = callArguments(source, CALL.lastIndex - 1);
    if (!args) {
      break;
    }
    const patterns = parsePatterns(args.text);
    const eager = Boolean(option(args.text, 'eager')?.[1] === 'true');
    const importName = option(args.text, 'import')?.[3];
    const raw = option(args.text, 'query')?.[3] === '?raw';
    const entries = matches(patterns, from).map((specifier) =>
      entrySource(specifier, from, { eager, importName, raw })
    );
    out += `${source.slice(cursor, call.index)}{ ${entries.join(', ')} }`;
    cursor = args.end;
    CALL.lastIndex = args.end;
    call = CALL.exec(source);
  }
  return out + source.slice(cursor);
}

module.exports = { expand };
