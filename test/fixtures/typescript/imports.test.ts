import { describe, expect, it } from 'vitest';
import { plain, static as serveStatic } from 'cjs-reserved';
import { area, type Options } from './lib.js';

describe('typescript', () => {
  it('imports ./lib.js from lib.ts, as TypeScript projects write it', () => {
    const options: Options = { size: 3 };
    expect(area(options)).toBe(9);
  });

  it('imports names of a CommonJS package that are reserved words', () => {
    expect(serveStatic()).toBe('static');
    expect(plain()).toBe('plain');
  });
});
