const fs = require('node:fs');
const { scan, COMMENT } = require('../modules/scanner');

const isSpace = (ch) => ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n';

function lineStarts(source) {
  const starts = [0];
  for (let i = source.indexOf('\n'); i !== -1; i = source.indexOf('\n', i + 1)) {
    starts.push(i + 1);
  }
  return starts;
}

// 1-based line of an offset.
function lineOf(starts, offset) {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (starts[mid] <= offset) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return low + 1;
}

// Brackets and separators alone (a closing "}" or "});") are not a statement, as in istanbul.
const PUNCTUATION = new Set(['{', '}', '(', ')', '[', ']', ';', ',']);

// Line hits: the highest count of the code on the line. Blank lines, comments and punctuation-only lines are not
// lines of code.
function lineHits(source, counts, starts) {
  const { kind } = scan(source);
  const lines = new Map();
  starts.forEach((start, index) => {
    const end = index + 1 < starts.length ? starts[index + 1] : source.length;
    let hits = -1;
    let statement = false;
    for (let i = start; i < end; i += 1) {
      if (!isSpace(source[i]) && kind[i] !== COMMENT) {
        hits = Math.max(hits, counts[i] ?? 0);
        statement ||= !PUNCTUATION.has(source[i]);
      }
    }
    if (statement) {
      lines.set(index + 1, hits);
    }
  });
  return lines;
}

// Coverage of one file: lines, functions and branches (V8 blocks) with their counts.
function fileCoverage(file, { counts, functions, blocks }) {
  const source = fs.readFileSync(file, 'utf8');
  const starts = lineStarts(source);
  const at = (offset) => ({ line: lineOf(starts, offset), count: counts[offset] ?? 0 });
  return {
    file,
    lines: lineHits(source, counts, starts),
    // The module is a function covering the whole script, not one of the file's functions.
    functions: functions
      .filter(({ startOffset, endOffset }) => !(startOffset === 0 && endOffset >= source.length))
      .map(({ name, startOffset }) => ({ name: name || '(anonymous)', ...at(startOffset) })),
    branches: blocks.map(({ startOffset }) => at(startOffset)),
  };
}

const metric = (items, covered) => ({ total: items.length, covered: items.filter(covered).length });

function summarize({ lines, functions, branches }) {
  const lineCounts = [...lines.values()];
  return {
    statements: metric(lineCounts, (hits) => hits > 0),
    branches: metric(branches, ({ count }) => count > 0),
    functions: metric(functions, ({ count }) => count > 0),
    lines: metric(lineCounts, (hits) => hits > 0),
  };
}

// "3-5,9": runs of uncovered statements, which may span lines that are not statements (blank, "}").
function uncoveredLines(lines) {
  const groups = [];
  let previousUncovered = false;
  [...lines].forEach(([line, hits]) => {
    if (hits !== 0) {
      previousUncovered = false;
    } else if (previousUncovered) {
      groups.at(-1)[1] = line;
    } else {
      groups.push([line, line]);
      previousUncovered = true;
    }
  });
  return groups.map(([from, to]) => (from === to ? String(from) : `${from}-${to}`)).join(',');
}

module.exports = { fileCoverage, summarize, uncoveredLines };
