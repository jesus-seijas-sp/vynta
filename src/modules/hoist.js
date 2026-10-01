const { scan } = require('./scanner');

// Calls moved to the top of the module, as babel-jest and vitest do. vi.doMock is not hoisted, by definition.
const HOISTED_CALL = /(?:vi|jest)\s*\.\s*(?:mock|unmock|hoisted|enableAutomock|disableAutomock)\s*\(/y;
const HOISTED_DECLARATION = /(?:const|let|var)\s+[^=;]+?=\s*(?:await\s+)?(?:vi|jest)\s*\.\s*hoisted\s*\(/y;
const STATIC_IMPORT = /import\s*(?:type\s+)?(?=[\w$*{'"])/y;
const QUICK_CHECK = /\b(?:vi|jest)\s*\.\s*(?:mock|unmock|hoisted)\s*\(/;

// A line that starts with one of these continues the previous statement.
const CONTINUES = new Set([',', '=', '.', '(', '[', '?', ':', '+', '-', '*', '/', '&', '|', '!', '<', '>', '%', '^']);

// Where the vi object is taken from in hoisted code: `vi` may be a binding declared further down (an import, or
// const { vi } = require('vitest')), which hoisted code can not see yet.
const VI = '__vyntra_vi__';
const HEADER = `const ${VI} = globalThis[Symbol.for('vyntra.vi')];`;

function statementStarts(scanner) {
  const { src } = scanner;
  const starts = [];
  for (let line = 0; line !== -1 && line < src.length; line = src.indexOf('\n', line) + 1 || -1) {
    let i = line;
    while (src[i] === ' ' || src[i] === '\t') {
      i += 1;
    }
    if (scanner.isCode(i) && scanner.depth[i] === 0 && !CONTINUES.has(scanner.previousCode(i))) {
      starts.push(i);
    }
  }
  return starts;
}

// End of a statement that is a call whose "(" is at open: after the ")" and an optional ";".
function callStatementEnd(scanner, open) {
  const close = scanner.closingParen(open);
  if (close === -1) {
    return -1;
  }
  const match = /[ \t]*;?/y;
  match.lastIndex = close + 1;
  match.exec(scanner.src);
  return match.lastIndex;
}

// End of an import declaration starting at start: after its module specifier, attributes and ";".
function importEnd(scanner, start) {
  const { src } = scanner;
  let i = start;
  while (i < src.length && scanner.kind[i] !== 1) {
    i += 1;
  }
  while (i < src.length && scanner.kind[i] === 1) {
    i += 1;
  }
  const rest = /\s*(?:(?:with|assert)\s*\{[^}]*\})?[ \t]*;?/y;
  rest.lastIndex = i;
  rest.exec(src);
  return rest.lastIndex;
}

// import a, { b as c } from 'x'  ->  const { default: a, b: c } = await import('x');
function toDynamicImport(statement) {
  const match = /^import\s*([\s\S]*?)\s*from\s*(['"][^'"]+['"])\s*(?:(?:with|assert)\s*(\{[^}]*\}))?\s*;?$/.exec(
    statement
  );
  if (!match) {
    const bare = /^import\s*(['"][^'"]+['"])/.exec(statement);
    return `await import(${bare[1]});`;
  }
  const [, clause, specifier, attributes] = match;
  const load = `await import(${specifier}${attributes ? `, { with: ${attributes} }` : ''})`;
  const namespace = /\*\s*as\s+([\w$]+)/.exec(clause);
  const defaultName = /^([\w$]+)/.exec(clause)?.[1];
  const named = /\{([^}]*)\}/.exec(clause)?.[1];
  const bindings = [];
  if (defaultName && !namespace) {
    bindings.push(`default: ${defaultName}`);
  }
  if (named) {
    named
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part && !part.startsWith('type '))
      .forEach((part) => {
        const [imported, local] = part.split(/\s+as\s+/);
        bindings.push(local ? `${imported.replace(/^['"]|['"]$/g, '')}: ${local}` : imported);
      });
  }
  if (namespace) {
    const ns = namespace[1];
    return defaultName ? `const ${ns} = ${load}; const { default: ${defaultName} } = ${ns};` : `const ${ns} = ${load};`;
  }
  return bindings.length > 0 ? `const { ${bindings.join(', ')} } = ${load};` : `${load};`;
}

const onlyNewlines = (text) => text.replace(/[^\n]/g, '');

// Rewrites a module so its mock calls run before anything it imports. Returns null when there is nothing to hoist.
// Line numbers are kept: removed code leaves its line breaks, and the hoisted code goes on the first line.
function hoistMocks(src, { esm = false } = {}) {
  if (!QUICK_CHECK.test(src)) {
    return null;
  }
  const scanner = scan(src);
  const hoisted = [];
  const replacements = [];
  statementStarts(scanner).forEach((start) => {
    if (replacements.length > 0 && start < replacements.at(-1).end) {
      return;
    }
    const patterns = [HOISTED_CALL, HOISTED_DECLARATION];
    const pattern = patterns.find((regex) => {
      regex.lastIndex = start;
      return regex.test(src);
    });
    if (pattern) {
      const end = callStatementEnd(scanner, pattern.lastIndex - 1);
      if (end !== -1) {
        const code = scanner.withoutComments(start, end).replace(/\s*\n\s*/g, ' ');
        hoisted.push(`${code.replace(/\b(?:vi|jest)(\s*\.)/g, `${VI}$1`)}${code.endsWith(';') ? '' : ';'}`);
        replacements.push({ start, end, text: onlyNewlines(src.slice(start, end)) });
      }
      return;
    }
    STATIC_IMPORT.lastIndex = start;
    if (esm && STATIC_IMPORT.test(src)) {
      const end = importEnd(scanner, start);
      const statement = src.slice(start, end);
      const text = /^import\s+type\b/.test(statement) ? '' : toDynamicImport(statement);
      replacements.push({ start, end, text: `${text}${onlyNewlines(statement)}` });
    }
  });
  if (hoisted.length === 0) {
    return null;
  }
  let body = '';
  let cursor = 0;
  replacements.forEach(({ start, end, text }) => {
    body += `${src.slice(cursor, start)}${text}`;
    cursor = end;
  });
  body += src.slice(cursor);
  // ES modules settle their (maybe async) mock factories before importing anything.
  const prepare = esm ? ` await globalThis[Symbol.for('vyntra.mocks')].prepare();` : '';
  const header = `${HEADER} ${hoisted.join(' ')}${prepare}`;
  // A "use strict" directive or a shebang must stay first.
  const first = /^(?:#![^\n]*|\s*(['"])use strict\1;?)/.exec(body);
  return first ? `${first[0]} ${header}${body.slice(first[0].length)}` : `${header} ${body}`;
}

module.exports = { hoistMocks };
