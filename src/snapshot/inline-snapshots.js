const fs = require('node:fs');
const { escapeTemplate } = require('./snapshot-file');

// Index just after the end of the string or template literal starting at i (templates may nest ${...}).
function skipLiteral(src, start) {
  const quote = src[start];
  let i = start + 1;
  while (i < src.length && src[i] !== quote) {
    if (src[i] === '\\') {
      i += 1;
    } else if (quote === '`' && src[i] === '$' && src[i + 1] === '{') {
      // eslint-disable-next-line no-use-before-define -- the two scanners call each other
      i = skipUntilClose(src, i + 2, '}') - 1;
    }
    i += 1;
  }
  return i + 1;
}

// Index just after the bracket that closes the one opened just before start.
function skipUntilClose(src, start, close) {
  const pairs = { '(': ')', '[': ']', '{': '}' };
  const stack = [close];
  let i = start;
  while (i < src.length && stack.length > 0) {
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      i = skipLiteral(src, i);
    } else if (ch === '/' && src[i + 1] === '/') {
      i = src.indexOf('\n', i);
    } else if (ch === '/' && src[i + 1] === '*') {
      i = src.indexOf('*/', i) + 2;
    } else {
      if (pairs[ch]) {
        stack.push(pairs[ch]);
      } else if (ch === stack.at(-1)) {
        stack.pop();
      }
      i += 1;
    }
  }
  return i;
}

// The top-level arguments of the call whose "(" is at open: [{ start, end }].
function callArguments(src, open) {
  const close = skipUntilClose(src, open + 1, ')') - 1;
  const args = [];
  let start = open + 1;
  let i = start;
  while (i < close) {
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      i = skipLiteral(src, i);
    } else if (ch === '(' || ch === '[' || ch === '{') {
      i = skipUntilClose(src, i + 1, { '(': ')', '[': ']', '{': '}' }[ch]);
    } else if (ch === ',') {
      args.push({ start, end: i });
      start = i + 1;
      i += 1;
    } else {
      i += 1;
    }
  }
  if (src.slice(start, close).trim()) {
    args.push({ start, end: close });
  }
  return { args: args.filter(({ start: s, end }) => src.slice(s, end).trim()), close };
}

function offsetOf(lines, line, column) {
  let offset = 0;
  for (let i = 0; i < line - 1; i += 1) {
    offset += lines[i].length + 1;
  }
  return offset + column - 1;
}

// The snapshot as a template literal indented under the line of the call.
function toTemplate(snapshot, indent) {
  if (!snapshot.includes('\n')) {
    return `\`${escapeTemplate(snapshot)}\``;
  }
  const body = escapeTemplate(snapshot)
    .split('\n')
    .map((line) => (line ? `${indent}  ${line}` : line))
    .join('\n');
  return `\`\n${body}\n${indent}\``;
}

// Writes the snapshots into the calls of toMatchInlineSnapshot(): [{ line, column, matcher, snapshot }].
function writeInlineSnapshots(file, updates) {
  let src = fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
  const lines = src.split('\n');
  const edits = updates.map(({ line, column, matcher, snapshot, hasProperties }) => {
    const call = src.indexOf(`${matcher}(`, offsetOf(lines, line, column));
    const open = call + matcher.length;
    const { args, close } = callArguments(src, open);
    const indent = /^\s*/.exec(lines[line - 1])[0];
    const template = toTemplate(snapshot, indent);
    // The snapshot is the argument after the property matchers, if any.
    const target = args[hasProperties ? 1 : 0];
    if (target) {
      return { start: target.start, end: target.end, text: template };
    }
    return { start: close, end: close, text: args.length > 0 ? `, ${template}` : template };
  });
  edits
    .sort((a, b) => b.start - a.start)
    .forEach(({ start, end, text }) => {
      const before = src.slice(0, start);
      const replaced = src.slice(start, end);
      // Keep the whitespace around a replaced argument.
      const lead = /^\s*/.exec(replaced)[0];
      const trail = /\s*$/.exec(replaced)[0];
      src = `${before}${replaced.trim() ? `${lead}${text}${trail}` : text}${src.slice(end)}`;
    });
  fs.writeFileSync(file, src);
}

// "\n    line\n  " as written in the source -> "line": removes the indentation added by toTemplate().
function stripIndentation(snapshot) {
  const lines = snapshot.split('\n');
  if (lines.length <= 2 || lines[0].trim() !== '' || lines.at(-1).trim() !== '') {
    return snapshot;
  }
  const body = lines.slice(1, -1);
  const indent = Math.min(...body.filter((line) => line.trim()).map((line) => /^\s*/.exec(line)[0].length));
  return body.map((line) => line.slice(indent)).join('\n');
}

module.exports = { writeInlineSnapshots, stripIndentation };
