const util = require('node:util');
const { format } = require('../expect/format');

// A tagged template table: the first chunk holds the headings, the values follow row by row.
function parseTemplate(strings, values) {
  const headings = strings[0]
    .split('|')
    .map((heading) => heading.trim())
    .filter(Boolean);
  if (headings.length === 0) {
    throw new Error('each tagged template must have column headings');
  }
  if (values.length % headings.length !== 0) {
    throw new Error(
      `Not enough arguments supplied for given headings:\n${headings.join(' | ')}\n\nReceived:\n${util.inspect(values)}`
    );
  }
  return Array.from({ length: values.length / headings.length }, (_, row) => ({
    values: Object.fromEntries(headings.map((heading, i) => [heading, values[row * headings.length + i]])),
    spread: false,
    object: true,
  }));
}

// Every case of a .each() table as { values, spread, object }: array rows are spread as arguments.
function normalizeTable(table) {
  if (Array.isArray(table[0]?.raw)) {
    return parseTemplate(table[0], table.slice(1));
  }
  const rows = table.length === 1 && Array.isArray(table[0]) ? table[0] : table;
  // Rows are spread into arguments only when every one is an array, as in Jest and vitest: in
  // ['abc', '', [], {}] the empty array is one more value, not an empty row.
  const spread = rows.every(Array.isArray);
  return rows.map((row) =>
    spread
      ? { values: row, spread: true }
      : { values: row, spread: false, object: row !== null && typeof row === 'object' }
  );
}

const pretty = (value) => format(value, { min: true, maxDepth: 1 });

const FORMATTERS = {
  '%s': (value) => (typeof value === 'string' ? value : util.format('%s', value)),
  '%d': (value) => util.format('%d', value),
  '%i': (value) => util.format('%i', value),
  '%f': (value) => String(Number(value)),
  '%j': (value) => {
    try {
      return JSON.stringify(value);
    } catch {
      return '[Circular]';
    }
  },
  '%o': (value) => util.format('%o', value),
  '%O': (value) => util.format('%O', value),
  '%p': pretty,
};

const getPath = (obj, path) => path.split('.').reduce((value, key) => value?.[key], obj);

// The title of one case: printf placeholders take the arguments in order, $name reads a key of an object case.
function formatTitle(title, row, index) {
  const args = row.spread ? row.values : [row.values];
  let name = typeof title === 'function' ? title.name : String(title);
  if (row.object) {
    name = name.replace(/\$([A-Za-z_$][\w$]*(?:\.[\w$]+)*)/g, (match, path) => pretty(getPath(row.values, path)));
  }
  let next = 0;
  return name.replace(/%[sdifjoOp#$%]/g, (placeholder) => {
    switch (placeholder) {
      case '%%':
        return '%';
      case '%#':
        return String(index);
      case '%$':
        return String(index + 1);
      default:
        if (next >= args.length) {
          return placeholder;
        }
        next += 1;
        return FORMATTERS[placeholder](args[next - 1]);
    }
  });
}

module.exports = { normalizeTable, formatTitle };
