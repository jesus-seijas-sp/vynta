const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { colors: c } = require('../colors');

const RUNTIME_DIR = path.join(__dirname, '..');
const FRAME = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/;

// file:///C:/x.js?vynta=3 -> C:\x.js
function toFilePath(location) {
  if (!location.startsWith('file:')) {
    return location;
  }
  try {
    return fileURLToPath(location.replace(/\?.*$/, ''));
  } catch {
    return location;
  }
}

function parseFrame(line) {
  const match = FRAME.exec(line);
  if (!match) {
    return null;
  }
  return { fn: match[1], file: toFilePath(match[2]), line: Number(match[3]), column: Number(match[4]) };
}

const isInternal = (frame) =>
  frame.file.startsWith('node:') ||
  frame.file.startsWith(RUNTIME_DIR) ||
  frame.file.includes(`${path.sep}node_modules${path.sep}`) ||
  !path.isAbsolute(frame.file);

// The frames of a stack that belong to the user's code.
function userFrames(stack = '') {
  return stack
    .split('\n')
    .map(parseFrame)
    .filter((frame) => frame && !isInternal(frame));
}

const sources = new Map();

function readSource(file) {
  if (!sources.has(file)) {
    try {
      sources.set(file, fs.readFileSync(file, 'utf8').split(/\r?\n/));
    } catch {
      sources.set(file, null);
    }
  }
  return sources.get(file);
}

// A few lines of source around a frame, with the column marked.
function codeFrame({ file, line, column }, context = 2) {
  const lines = readSource(file);
  if (!lines || line > lines.length) {
    return '';
  }
  const first = Math.max(1, line - context);
  const last = Math.min(lines.length, line + context);
  const width = String(last).length;
  const output = [];
  for (let n = first; n <= last; n += 1) {
    const gutter = String(n).padStart(width);
    const text = lines[n - 1].replaceAll('\t', '  ');
    if (n === line) {
      output.push(`${c.red('>')} ${c.dim(`${gutter} |`)} ${text}`);
      output.push(`  ${' '.repeat(width)} ${c.dim('|')} ${' '.repeat(Math.max(0, column - 1))}${c.red('^')}`);
    } else {
      output.push(`  ${c.dim(`${gutter} |`)} ${text}`);
    }
  }
  return output.join('\n');
}

module.exports = { userFrames, codeFrame };
