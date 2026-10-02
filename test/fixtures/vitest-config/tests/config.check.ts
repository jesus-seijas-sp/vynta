import { describe, expect, it } from 'vitest';
import { fromLib } from '@lib';
import { fromOther } from '~/other.js';

describe('vitest config', () => {
  it('runs the files its include names', () => {
    expect(true).toBe(true);
  });

  it('resolves test.alias and resolve.alias', () => {
    expect(fromLib).toBe('lib');
    expect(fromOther).toBe('other');
  });

  it('runs its setup files and sets its env', () => {
    expect((globalThis as { setupRan?: boolean }).setupRan).toBe(true);
    expect(process.env.FROM_CONFIG).toBe('yes');
  });
});
