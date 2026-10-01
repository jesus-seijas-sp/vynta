import { afterEach, describe, expect, it, vi } from 'vitest';
import * as greeting from './esm/greeting.mjs';
import { loud, welcome } from './esm/uses-greeting.mjs';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('vi.spyOn on a module namespace', () => {
  it('reaches the modules that import the export', () => {
    vi.spyOn(greeting, 'greet').mockReturnValue('spied');
    expect(welcome('bo')).toBe('spied!');
    expect(greeting.greet).toHaveBeenCalledWith('bo');
  });

  it('spies on a default export', () => {
    vi.spyOn(greeting, 'default').mockReturnValue('quiet');
    expect(loud('bo')).toBe('quiet');
  });

  it('puts the original back on restore', () => {
    expect(welcome('bo')).toBe('hi bo!');
    expect(loud('bo')).toBe('BO');
  });
});
