// A lexical pass over JavaScript source that tells, for every character, what it is part of (code, string,
// template text, comment or regular expression) and the bracket depth before it. It is not a parser, but it is what
// hoisting needs: finding top-level statements and where calls end, without being fooled by strings or comments.

const CODE = 0;
const STRING = 1;
const TEMPLATE = 2;
const COMMENT = 3;
const REGEX = 4;

// After these a "/" starts a regular expression rather than a division.
const REGEX_AFTER = new Set([
  '',
  '(',
  ',',
  '=',
  ':',
  '[',
  '!',
  '&',
  '|',
  '?',
  '{',
  '}',
  ';',
  '+',
  '-',
  '*',
  '%',
  '<',
  '>',
  '~',
  '^',
]);
const REGEX_AFTER_WORDS = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'throw',
  'case',
  'do',
  'else',
  'yield',
  'await',
]);

const isWordChar = (ch) => /[\w$]/.test(ch);
const isSpace = (ch) => ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';

class Scanner {
  constructor(src) {
    this.src = src;
    this.kind = new Uint8Array(src.length);
    this.depth = new Int32Array(src.length + 1);
    // Depth at which each open template ${ started.
    this.templates = [];
    this.d = 0;
    this.prev = '';
    this.word = '';
  }

  mark(start, end, kind) {
    this.kind.fill(kind, start, end);
    this.depth.fill(this.d, start, end);
  }

  // From start (a backtick, or the "}" closing a ${...}), up to the end of the template or the next "${".
  templateText(start) {
    const { src } = this;
    let j = start + 1;
    while (j < src.length && src[j] !== '`' && !(src[j] === '$' && src[j + 1] === '{')) {
      j += src[j] === '\\' ? 2 : 1;
    }
    if (src[j] === '`') {
      this.mark(start, j + 1, TEMPLATE);
      this.prev = 'a';
      return j + 1;
    }
    this.mark(start, j + 2, TEMPLATE);
    this.templates.push(this.d);
    this.d += 1;
    this.prev = '{';
    return j + 2;
  }

  quoted(i, quote) {
    const { src } = this;
    let j = i + 1;
    while (j < src.length && src[j] !== quote && src[j] !== '\n') {
      j += src[j] === '\\' ? 2 : 1;
    }
    this.mark(i, j + 1, STRING);
    this.prev = 'a';
    return j + 1;
  }

  regex(i) {
    const { src } = this;
    let j = i + 1;
    let inClass = false;
    while (j < src.length && src[j] !== '\n' && (inClass || src[j] !== '/')) {
      if (src[j] === '\\') {
        j += 1;
      } else if (src[j] === '[') {
        inClass = true;
      } else if (src[j] === ']') {
        inClass = false;
      }
      j += 1;
    }
    j += 1;
    while (j < src.length && isWordChar(src[j])) {
      j += 1;
    }
    this.mark(i, j, REGEX);
    this.prev = 'a';
    return j;
  }

  regexAllowed() {
    return REGEX_AFTER.has(this.prev) || (isWordChar(this.prev) && REGEX_AFTER_WORDS.has(this.word));
  }

  // One step from i; returns the next index.
  step(i) {
    const { src } = this;
    const ch = src[i];
    const next = src[i + 1];
    if (ch === '/' && next === '/') {
      const end = src.indexOf('\n', i);
      this.mark(i, end === -1 ? src.length : end, COMMENT);
      return end === -1 ? src.length : end;
    }
    if (ch === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      this.mark(i, stop, COMMENT);
      return stop;
    }
    if (ch === '"' || ch === "'") {
      return this.quoted(i, ch);
    }
    if (ch === '`') {
      return this.templateText(i);
    }
    if (ch === '}' && this.templates.length > 0 && this.templates.at(-1) === this.d - 1) {
      this.templates.pop();
      this.d -= 1;
      return this.templateText(i);
    }
    if (ch === '/' && this.regexAllowed()) {
      return this.regex(i);
    }
    this.depth[i] = this.d;
    if (ch === '(' || ch === '[' || ch === '{') {
      this.d += 1;
    } else if (ch === ')' || ch === ']' || ch === '}') {
      this.d -= 1;
    }
    if (!isSpace(ch)) {
      this.word = isWordChar(ch) && isWordChar(this.prev) ? `${this.word}${ch}` : ch;
      this.prev = ch;
    }
    return i + 1;
  }

  run() {
    let i = 0;
    while (i < this.src.length) {
      i = this.step(i);
    }
    this.depth[this.src.length] = this.d;
    return this;
  }

  isCode(i) {
    return this.kind[i] === CODE;
  }

  // The last code character before i that is not whitespace, or ''.
  previousCode(i) {
    for (let j = i - 1; j >= 0; j -= 1) {
      if (this.kind[j] === CODE && !isSpace(this.src[j])) {
        return this.src[j];
      }
    }
    return '';
  }

  // Index of the ")" that closes the "(" at open, or -1.
  closingParen(open) {
    const level = this.depth[open] + 1;
    for (let j = open + 1; j < this.src.length; j += 1) {
      if (this.src[j] === ')' && this.kind[j] === CODE && this.depth[j] === level) {
        return j;
      }
    }
    return -1;
  }

  // The source without its comments.
  withoutComments(start, end) {
    let result = '';
    for (let i = start; i < end; i += 1) {
      if (this.kind[i] !== COMMENT) {
        result += this.src[i];
      }
    }
    return result;
  }
}

function scan(src) {
  return new Scanner(src).run();
}

module.exports = { scan, CODE, STRING, TEMPLATE, COMMENT, REGEX };
