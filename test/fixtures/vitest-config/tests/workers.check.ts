import { expect, it } from 'vitest';
import { fromOther } from '~/other.js';

it('has the aliases and env of the config in a worker too', () => {
  expect(fromOther).toBe('other');
  expect(process.env.FROM_CONFIG).toBe('yes');
});
