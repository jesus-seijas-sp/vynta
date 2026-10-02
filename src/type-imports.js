const fs = require('node:fs');
const path = require('node:path');
const { resolveFile, mapToFile } = require('./resolve-paths');
const { scan, CODE } = require('./modules/scanner');

// A TypeScript file compiled on its own can not tell an imported interface from a class: `import { Options }` stays
// in the output when Options types a decorated constructor parameter (the decorator metadata may need its value),
// and an ES module that imports a name its target does not export fails to link. TypeScript itself, seeing the
// whole program, drops it; bundlers' module runners never link real ES modules, so they do not notice. Here the
// names a project module only declares as types are marked `type` in the importing file, which tells the
// transformer to drop them. Only what is known for sure is marked: names of packages, and names a file declares
// both as a type and as a value, are left as they are.

const TS_FILE = /\.[cm]?tsx?$/;
const IMPORT_LIST = /\b(import|export)\s+(?!type\b)((?:[\w$]+\s*,\s*)?)\{([^}]*)\}\s*from\s*(['"])([^'"\n]+)\4/g;

const TYPE_DECLARATION = /\b(?:declare\s+)?(?:interface|type)\s+([\w$]+)/g;
const VALUE_DECLARATION =
  /\b(?:declare\s+)?(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(?:class|function\*?|const|let|var|enum|namespace|module)\s+([\w$]+)/g;
const EXPORT_DECLARATION = /\bexport\s+(?:declare\s+)?(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(\w+)\*?\s+([\w$]+)/g;
const EXPORT_LIST = /\bexport\s+(type\s+)?\{([^}]*)\}(?:\s*from\s*(['"])([^'"\n]+)\3)?/g;
const EXPORT_STAR = /\bexport\s+\*\s+(as\s+[\w$]+\s+)?from\s*(['"])([^'"\n]+)\2/g;

const TYPE_KEYWORDS = new Set(['interface', 'type']);

// Matches of a pattern that start in code, not in a string or a comment.
function matchesInCode(pattern, source, kind) {
  return [...source.matchAll(pattern)].filter((match) => kind[match.index] === CODE);
}

// The names of a list ("A, type B, C as D"): { local, exported, type }.
function listNames(list) {
  return list
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const type = /^type\s/.test(part);
      const [local, exported = local] = part.replace(/^type\s+/, '').split(/\s+as\s+/);
      return { local: local.trim(), exported: exported.trim(), type };
    });
}

function resolveSpecifier(specifier, fromFile) {
  const dir = path.dirname(fromFile);
  const file =
    specifier.startsWith('.') || path.isAbsolute(specifier) ? resolveFile(specifier, dir) : mapToFile(specifier, dir);
  return file && TS_FILE.test(file) ? file : null;
}

// What a module exports, as far as telling types from values goes.
const modules = new Map();

function exportsOf(file) {
  if (modules.has(file)) {
    return modules.get(file);
  }
  const info = { types: new Set(), values: new Set(), forwards: new Map(), stars: [] };
  modules.set(file, info);
  let source;
  try {
    source = fs.readFileSync(file, 'utf8');
  } catch {
    return info;
  }
  const { kind } = scan(source);
  const localTypes = new Set(matchesInCode(TYPE_DECLARATION, source, kind).map((match) => match[1]));
  const localValues = new Set(matchesInCode(VALUE_DECLARATION, source, kind).map((match) => match[1]));
  matchesInCode(EXPORT_DECLARATION, source, kind).forEach(([, keyword, name]) => {
    (TYPE_KEYWORDS.has(keyword) ? info.types : info.values).add(name);
  });
  matchesInCode(EXPORT_LIST, source, kind).forEach(([, typeList, list, , specifier]) => {
    listNames(list).forEach(({ local, exported, type }) => {
      if (typeList || type) {
        info.types.add(exported);
      } else if (specifier) {
        info.forwards.set(exported, { specifier, name: local });
      } else if (localTypes.has(local) && !localValues.has(local)) {
        info.types.add(exported);
      } else {
        info.values.add(exported);
      }
    });
  });
  matchesInCode(EXPORT_STAR, source, kind).forEach(([, namespace, , specifier]) => {
    if (namespace) {
      info.values.add(namespace.replace(/^as\s+/, '').trim());
    } else {
      info.stars.push(specifier);
    }
  });
  return info;
}

// 'type', 'value', or null when unknown.
function kindOf(file, name, seen = new Set()) {
  const key = `${file}\0${name}`;
  if (seen.has(key)) {
    return null;
  }
  seen.add(key);
  const info = exportsOf(file);
  if (info.values.has(name)) {
    return 'value';
  }
  if (info.types.has(name)) {
    return 'type';
  }
  const forward = info.forwards.get(name);
  if (forward) {
    const target = resolveSpecifier(forward.specifier, file);
    return target ? kindOf(target, forward.name, seen) : null;
  }
  for (let i = 0; i < info.stars.length; i += 1) {
    const target = resolveSpecifier(info.stars[i], file);
    const found = target ? kindOf(target, name, seen) : null;
    if (found) {
      return found;
    }
  }
  return null;
}

// The source with the imported (and re-exported) names that are only types marked `type`.
function markTypeImports(source, file) {
  if (!source.includes('{')) {
    return source;
  }
  const { kind } = scan(source);
  let result = '';
  let last = 0;
  matchesInCode(IMPORT_LIST, source, kind).forEach((match) => {
    const [whole, keyword, defaultPart, list, quote, specifier] = match;
    const target = resolveSpecifier(specifier, file);
    if (!target) {
      return;
    }
    const names = listNames(list);
    // The name a list takes from its target is the one before "as", for imports and re-exports alike.
    const marked = names.map((name) => ({ ...name, type: name.type || kindOf(target, name.local) === 'type' }));
    if (marked.every((name, i) => name.type === names[i].type)) {
      return;
    }
    const entries = marked.map(
      ({ local, exported, type }) => `${type ? 'type ' : ''}${local}${exported === local ? '' : ` as ${exported}`}`
    );
    // Line breaks are kept, so the source map's lines still match.
    const breaks = '\n'.repeat((whole.match(/\n/g) ?? []).length);
    result += source.slice(last, match.index);
    result += `${keyword} ${defaultPart}{ ${entries.join(', ')} } from ${quote}${specifier}${quote}${breaks}`;
    last = match.index + whole.length;
  });
  return last === 0 ? source : result + source.slice(last);
}

module.exports = { markTypeImports };
