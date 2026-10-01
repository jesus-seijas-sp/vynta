const { hoistMocks } = require('../src/modules/hoist');

const lines = (text) => text.split('\n').length;

describe('hoistMocks', () => {
  it('leaves files without mocks alone', () => {
    expect(hoistMocks("const a = require('a');\nit('x', () => {});")).toBeNull();
  });

  it('moves top-level mock calls to the first line, keeping line numbers', () => {
    const src = [
      "'use strict';",
      "const { add } = require('./math')",
      "jest.mock('./math', () => ({",
      '  // a comment with a paren (',
      "  add: jest.fn(() => ')'),",
      '}));',
      "it('adds', () => {});",
    ].join('\n');
    const result = hoistMocks(src);
    expect(lines(result)).toBe(lines(src));
    expect(result.split('\n')[0]).toBe(
      "'use strict'; const __vyntra_vi__ = globalThis[Symbol.for('vyntra.vi')]; __vyntra_vi__.mock('./math', () => ({ add: __vyntra_vi__.fn(() => ')'), }));"
    );
    expect(result.split('\n')[1]).toBe("const { add } = require('./math')");
    expect(result.split('\n')[6]).toBe("it('adds', () => {});");
  });

  it('ignores mock calls in strings, templates, comments, regular expressions and nested blocks', () => {
    const src = [
      'const s = \'jest.mock("a")\';',
      'const t = `',
      "jest.mock('b')`;",
      "// jest.mock('c')",
      String.raw`const r = /jest.mock\('d'/;`,
      "describe('x', () => {",
      "  jest.mock('e');",
      '});',
      "vi.hoisted(() => 'f');",
    ].join('\n');
    const result = hoistMocks(src);
    expect(result.split('\n')[0]).toBe(
      "const __vyntra_vi__ = globalThis[Symbol.for('vyntra.vi')]; __vyntra_vi__.hoisted(() => 'f'); const s = 'jest.mock(\"a\")';"
    );
    expect(result).toContain("  jest.mock('e');");
  });

  it('turns the static imports of an ES module into imports after the mocks', () => {
    const src = [
      "import { vi } from 'vitest';",
      "import def, { a as b, c } from './dep.js';",
      "import * as ns from 'node:path';",
      "import 'side-effect';",
      "import type { T } from './types';",
      "vi.mock('./dep.js');",
    ].join('\n');
    expect(hoistMocks(src, { esm: true }).split('\n')).toEqual([
      "const __vyntra_vi__ = globalThis[Symbol.for('vyntra.vi')]; __vyntra_vi__.mock('./dep.js'); await globalThis[Symbol.for('vyntra.mocks')].prepare(); const { vi } = await import('vitest');",
      "const { default: def, a: b, c } = await import('./dep.js');",
      "const ns = await import('node:path');",
      "await import('side-effect');",
      '',
      '',
    ]);
  });
});
