const fs = require('node:fs');
const path = require('node:path');

// The compiler options that change what a file compiles to, not only how it is checked: the decorators a project
// uses (legacy ones, with the metadata dependency injection reads) and how class fields are defined.
const OPTIONS = ['experimentalDecorators', 'emitDecoratorMetadata', 'useDefineForClassFields'];

// tsconfig.json is JSON with comments and trailing commas.
function parseJsonc(text) {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      out += char;
      if (char === '\\') {
        out += text[i + 1] ?? '';
        i += 1;
      } else if (char === '"') {
        inString = false;
      }
    } else if (char === '"') {
      inString = true;
      out += char;
    } else if (char === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') {
        i += 1;
      }
      out += '\n';
    } else if (char === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2);
      i = i === -1 ? text.length : i + 1;
    } else {
      out += char;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

// The compiler options of a tsconfig file, those of the files it extends (relative paths) under its own.
function readOptions(file, seen = new Set()) {
  if (seen.has(file)) {
    return {};
  }
  seen.add(file);
  let config;
  try {
    config = parseJsonc(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
  const bases = [config.extends ?? []].flat().filter((base) => base.startsWith('.'));
  const inherited = bases.map((base) => {
    const target = path.resolve(path.dirname(file), base);
    return readOptions(target.endsWith('.json') ? target : `${target}.json`, seen);
  });
  return Object.assign({}, ...inherited, config.compilerOptions);
}

const byRoot = new Map();

// The options of the project's tsconfig.json that its files must be compiled with, as { name: value }.
function compileOptions(rootDir) {
  if (!byRoot.has(rootDir)) {
    const all = readOptions(path.join(rootDir, 'tsconfig.json'));
    byRoot.set(rootDir, Object.fromEntries(OPTIONS.filter((name) => name in all).map((name) => [name, all[name]])));
  }
  return byRoot.get(rootDir);
}

module.exports = { compileOptions };
