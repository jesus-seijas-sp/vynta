import { describe, expect, it, vi } from 'vitest';
import { hello } from './esm/uses.mjs';
import def, { greet, shout } from './esm/dep.mjs';
import { readFileSync } from 'node:fs';

const { spy } = vi.hoisted(() => ({ spy: vi.fn(() => 'from hoisted') }));

vi.mock('./esm/dep.mjs', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, greet: vi.fn(() => 'mocked greet') };
});
vi.mock('node:fs', () => ({ readFileSync: spy }));

describe('vi.mock in ES modules', () => {
  it('mocks what the module under test imports', () => {
    expect(hello()).toBe('mocked greet');
    expect(greet).toHaveBeenCalledWith('ann');
  });

  it('keeps what the factory takes from importOriginal', () => {
    expect(shout('x')).toBe('HI x');
    expect(def).toBe('real default');
  });

  it('mocks builtins with values from vi.hoisted', () => {
    expect(readFileSync('anything')).toBe('from hoisted');
    expect(spy).toHaveBeenCalledOnce();
  });

  it('gives the real module with vi.importActual', async () => {
    const actual = await vi.importActual('./esm/dep.mjs');
    expect(actual.greet('bo')).toBe('hi bo');
  });
});
