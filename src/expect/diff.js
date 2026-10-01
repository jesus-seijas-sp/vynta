const { colors: c } = require('../colors');
const { format } = require('./format');

const CONTEXT_LINES = 5;

// Myers O(ND) diff of two arrays of lines. Returns [op, line] pairs, op being ' ', '-' (only in a) or '+' (only in b).
function diffLines(a, b) {
  const max = a.length + b.length;
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace = [];
  const pickDown = (vd, k, d) => k === -d || (k !== d && vd[offset + k - 1] < vd[offset + k + 1]);
  let found = false;
  for (let d = 0; d <= max && !found; d += 1) {
    trace.push(v.slice());
    for (let k = -d; k <= d && !found; k += 2) {
      let x = pickDown(v, k, d) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < a.length && y < b.length && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      found = x >= a.length && y >= b.length;
    }
  }
  const result = [];
  let x = a.length;
  let y = b.length;
  for (let d = trace.length - 1; d >= 0; d -= 1) {
    const vd = trace[d];
    const k = x - y;
    const prevK = pickDown(vd, k, d) ? k + 1 : k - 1;
    const prevX = vd[offset + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      result.push([' ', a[x - 1]]);
      x -= 1;
      y -= 1;
    }
    if (d > 0) {
      result.push(x === prevX ? ['+', b[y - 1]] : ['-', a[x - 1]]);
    }
    x = prevX;
    y = prevY;
  }
  return result.reverse();
}

const LINE_STYLE = {
  '-': (line) => c.green(`- ${line}`),
  '+': (line) => c.red(`+ ${line}`),
  ' ': (line) => c.dim(`  ${line}`),
};

// Prints the changes with a few lines of context around them, folding the rest.
function render(ops) {
  const visible = new Uint8Array(ops.length);
  ops.forEach(([op], i) => {
    if (op !== ' ') {
      visible.fill(1, Math.max(0, i - CONTEXT_LINES), i + CONTEXT_LINES + 1);
    }
  });
  const removed = ops.filter(([op]) => op === '-').length;
  const added = ops.filter(([op]) => op === '+').length;
  const lines = [c.green(`- Expected  - ${removed}`), c.red(`+ Received  + ${added}`), ''];
  ops.forEach(([op, line], i) => {
    if (visible[i]) {
      lines.push(LINE_STYLE[op](line));
    } else if (i === 0 || visible[i - 1]) {
      lines.push(c.yellow('@@ ... @@'));
    }
  });
  return lines.join('\n');
}

const isPlain = (value) => {
  const proto = Object.getPrototypeOf(value);
  return Array.isArray(value) || proto === Object.prototype || proto === null;
};

// A copy of expected where the asymmetric matchers that match are replaced by the received values, so the diff only
// shows what really differs.
function replaceMatched(expected, received, equals, seen = new WeakSet()) {
  if (!expected || typeof expected !== 'object' || !received || typeof received !== 'object') {
    return expected;
  }
  if (seen.has(expected) || !isPlain(expected)) {
    return expected;
  }
  seen.add(expected);
  const copy = Array.isArray(expected) ? [] : {};
  Object.entries(expected).forEach(([key, value]) => {
    const matches = typeof value?.asymmetricMatch === 'function' && key in received && equals(received[key], value);
    copy[key] = matches ? received[key] : replaceMatched(value, received[key], equals, seen);
  });
  return copy;
}

const isSimple = (value) => value === null || (typeof value !== 'object' && typeof value !== 'function');

// The diff of two values, or null when a diff would not help (primitives, single-line strings).
function diff(expected, received, equals) {
  if (typeof expected === 'string' && typeof received === 'string') {
    if (!expected.includes('\n') && !received.includes('\n')) {
      return null;
    }
    return render(diffLines(expected.split('\n'), received.split('\n')));
  }
  if (isSimple(expected) || isSimple(received)) {
    return null;
  }
  const a = format(equals ? replaceMatched(expected, received, equals) : expected);
  const b = format(received);
  if (a === b) {
    return null;
  }
  return render(diffLines(a.split('\n'), b.split('\n')));
}

module.exports = { diff, diffLines };
