import { describe, expect, it } from 'vitest';
import fromRequire from './helper.cjs';
import fromImport from './data.json';
import withAttributes from './data.json' with { type: 'json' };

describe('json', () => {
  it('is module.exports for a require of CommonJS an ES module imported', () => {
    expect(fromRequire).toEqual({ answer: 42, list: [1, 2] });
  });

  it('is the default export for an import without attributes', () => {
    expect(fromImport).toEqual({ answer: 42, list: [1, 2] });
  });

  it('is the default export for an import with { type: json }', () => {
    expect(withAttributes).toEqual({ answer: 42, list: [1, 2] });
  });
});
