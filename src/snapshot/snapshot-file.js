const fs = require('node:fs');

const JEST_HEADER = '// Jest Snapshot v1, https://jestjs.io/docs/snapshot-testing';
const VITEST_HEADER = '// Vitest Snapshot v1, https://vitest.dev/guide/snapshot.html';

// In a snapshot file values are template literals: backticks, backslashes and ${ are escaped.
const escapeTemplate = (str) => str.replace(/`|\\|\$\{/g, '\\$&');

// Multi-line values start and end on their own line, as Jest writes them.
const wrapLines = (value) => (value.includes('\n') ? `\n${value}\n` : value);

const naturalOrder = (a, b) => a.localeCompare(b, 'en', { numeric: true });

// Reads a .snap file: { data: { key: value }, style: 'jest' | 'vitest' }. A snapshot file is the project's own
// code (exports[`name`] = `value`;), so it is evaluated as Jest does.
function readSnapshotFile(file) {
  let content;
  try {
    content = fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
  } catch {
    return { data: {}, style: 'jest', exists: false };
  }
  const data = {};
  // eslint-disable-next-line no-new-func -- the snapshot file format is JavaScript
  new Function('exports', content)(data);
  Object.keys(data).forEach((key) => {
    const value = data[key];
    // The line breaks wrapLines() added are not part of the value.
    data[key] = value.startsWith('\n') && value.endsWith('\n') ? value.slice(1, -1) : value;
  });
  return { data, style: content.startsWith('// Vitest') ? 'vitest' : 'jest', exists: true };
}

function writeSnapshotFile(file, data, style) {
  const keys = Object.keys(data).sort(naturalOrder);
  const header = style === 'vitest' ? VITEST_HEADER : JEST_HEADER;
  const entries = keys.map(
    (key) => `exports[\`${escapeTemplate(key)}\`] = \`${escapeTemplate(wrapLines(data[key]))}\`;`
  );
  fs.writeFileSync(file, `${header}\n\n${entries.join('\n\n')}\n`);
}

module.exports = { readSnapshotFile, writeSnapshotFile, escapeTemplate };
