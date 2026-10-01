// A small pretty-printer in the spirit of pretty-format: sorted keys, trailing commas and class names for
// instances. It prints failures and snapshots, so it favours output compatible with Jest over speed.

const ASYMMETRIC = Symbol.for('jest.asymmetricMatcher');

// escapeString: escape quotes and backslashes of strings (snapshots, as in Jest 29+, do not).
// plugins: pretty-format plugins, from expect.addSnapshotSerializer().
const DEFAULTS = { indent: '  ', maxDepth: Infinity, min: false, raw: false, escapeString: true, plugins: [] };

const isAsymmetric = (value) =>
  Boolean(value) && (value.$$typeof === ASYMMETRIC || typeof value.asymmetricMatch === 'function');

function quote(str, escape = true) {
  const body = escape ? str.replaceAll('\\', '\\\\').replaceAll('"', '\\"') : str;
  return `"${body}"`;
}

const formatKey = (key, escape) => (typeof key === 'symbol' ? `[${key.toString()}]` : quote(key, escape));

const formatError = (error) => `[${error.name || 'Error'}: ${error.message}]`;

function className(value) {
  const ctor = Object.getPrototypeOf(value)?.constructor;
  return (typeof ctor === 'function' && ctor.name) || 'Object';
}

function formatPrimitive(value, { raw, escapeString }) {
  switch (typeof value) {
    case 'string':
      return raw ? value : quote(value, escapeString);
    case 'number':
      return Object.is(value, -0) ? '-0' : String(value);
    case 'bigint':
      return `${value}n`;
    case 'symbol':
      return value.toString();
    case 'function':
      return `[Function ${value.name || 'anonymous'}]`;
    default:
      return String(value);
  }
}

function ownKeys(value) {
  const symbols = Object.getOwnPropertySymbols(value).filter((symbol) =>
    Object.prototype.propertyIsEnumerable.call(value, symbol)
  );
  return [...Object.keys(value).sort(), ...symbols];
}

// Wraps already formatted items between open and close, on one line or indented.
function wrap(open, items, close, options, indent) {
  if (items.length === 0) {
    return `${open}${close}`;
  }
  if (options.min) {
    return `${open}${items.join(', ')}${close}`;
  }
  const inner = `${indent}${options.indent}`;
  return `${open}\n${inner}${items.join(`,\n${inner}`)},\n${indent}${close}`;
}

function formatFunction(value, options) {
  if (value._isMockFunction) {
    const name = value.getMockName?.();
    return name && name !== 'vi.fn()' ? `[MockFunction ${name}]` : '[MockFunction]';
  }
  return formatPrimitive(value, options);
}

function formatAsymmetric(value) {
  if (typeof value.toAsymmetricMatcher === 'function') {
    return value.toAsymmetricMatcher();
  }
  return typeof value.toString === 'function' ? value.toString() : 'AsymmetricMatcher';
}

// Values printed without looking inside them; undefined when the value is a container.
function formatLeaf(value, tag, options) {
  switch (tag) {
    case '[object Date]':
      return Number.isNaN(value.getTime()) ? 'Date { NaN }' : value.toISOString();
    case '[object RegExp]':
      return String(value);
    case '[object Error]':
      return formatError(value);
    case '[object Boolean]':
    case '[object Number]':
    case '[object String]':
      return `[${className(value)}: ${formatPrimitive(value.valueOf(), options)}]`;
    case '[object Symbol]':
      return value.toString();
    case '[object WeakMap]':
    case '[object WeakSet]':
    case '[object Promise]':
      return `${className(value)} {}`;
    default:
      return value instanceof Error ? formatError(value) : undefined;
  }
}

const isDomNode = (value) =>
  typeof value?.nodeType === 'number' && typeof value.nodeName === 'string' && typeof value.cloneNode === 'function';

// A node of a document prints as its markup, as pretty-format's DOM plugins do. Its properties
// reach the whole document (ownerDocument, parentNode) and would print it again from every node.
function formatDomNode(node) {
  switch (node.nodeType) {
    case 3:
      return quote(node.data);
    case 8:
      return `<!--${node.data}-->`;
    case 9:
      return '#document';
    case 11:
      return `<DocumentFragment>${[...node.childNodes].map(formatDomNode).join('')}</DocumentFragment>`;
    default:
      return node.outerHTML ?? `<${node.nodeName.toLowerCase()} />`;
  }
}

class Printer {
  constructor(options) {
    this.options = options;
    this.seen = [];
  }

  print(value, indent = '', depth = 0) {
    const { options } = this;
    const plugin = options.plugins.length > 0 ? options.plugins.find((candidate) => candidate.test(value)) : undefined;
    if (plugin) {
      return this.printPlugin(plugin, value, indent, depth);
    }
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
      return formatPrimitive(value, options);
    }
    if (typeof value === 'function') {
      return formatFunction(value, options);
    }
    if (isAsymmetric(value)) {
      return formatAsymmetric(value);
    }
    if (isDomNode(value)) {
      return formatDomNode(value);
    }
    if (this.seen.includes(value)) {
      return '[Circular]';
    }
    const tag = Object.prototype.toString.call(value);
    const leaf = formatLeaf(value, tag, options);
    if (leaf !== undefined) {
      return leaf;
    }
    if (depth >= options.maxDepth) {
      return Array.isArray(value) ? '[Array]' : `[${className(value)}]`;
    }
    this.seen.push(value);
    const result = this.printContainer(value, tag, indent, depth);
    this.seen.pop();
    return result;
  }

  printContainer(value, tag, indent, depth) {
    const { options } = this;
    const next = `${indent}${options.indent}`;
    const printChild = (child) => this.print(child, next, depth + 1);
    const name = className(value);
    if (Array.isArray(value) || ArrayBuffer.isView(value)) {
      const items = Array.from({ length: value.length }, (_, i) => (i in value ? printChild(value[i]) : '<empty>'));
      return wrap(name === 'Array' ? '[' : `${name} [`, items, ']', options, indent);
    }
    if (tag === '[object Map]') {
      const items = [...value].map(([key, val]) => `${printChild(key)} => ${printChild(val)}`);
      return wrap(`${name} {`, items, '}', options, indent);
    }
    if (tag === '[object Set]') {
      return wrap(`${name} {`, [...value].map(printChild), '}', options, indent);
    }
    if (tag === '[object ArrayBuffer]') {
      return wrap('ArrayBuffer [', Array.from(new Uint8Array(value), String), ']', options, indent);
    }
    const items = ownKeys(value).map((key) => `${formatKey(key, options.escapeString)}: ${printChild(value[key])}`);
    return wrap(name === 'Object' ? '{' : `${name} {`, items, '}', options, indent);
  }

  // A pretty-format plugin, with its new API (serialize) or its old one (print).
  printPlugin(plugin, value, indent, depth) {
    const { options } = this;
    if (typeof plugin.serialize === 'function') {
      const config = { ...options, spacingOuter: options.min ? '' : '\n', spacingInner: options.min ? ' ' : '\n' };
      const printer = (child, childConfig, childIndent = indent, childDepth = depth) =>
        this.print(child, childIndent, childDepth);
      return plugin.serialize(value, config, indent, depth, this.seen, printer);
    }
    const indentLines = (str) =>
      str
        .split('\n')
        .map((line) => `${options.indent}${line}`)
        .join('\n');
    const colors = { comment: {}, content: {}, prop: {}, tag: {}, value: {} };
    const printOptions = { edgeSpacing: '\n', min: options.min, spacing: '\n' };
    return plugin.print(value, (child) => this.print(child, indent, depth + 1), indentLines, printOptions, colors);
  }
}

function format(value, options = {}) {
  return new Printer({ ...DEFAULTS, ...options }).print(value);
}

// Single-line form used in "Expected:" / "Received:" lines, made shallower when too long.
function stringify(value, maxLength = 10000) {
  let result = format(value, { min: true });
  for (let depth = 5; depth > 0 && result.length > maxLength; depth -= 1) {
    result = format(value, { min: true, maxDepth: depth });
  }
  return result;
}

module.exports = { format, stringify, isAsymmetric, className };
