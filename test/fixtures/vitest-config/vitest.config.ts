import { configDefaults, defineConfig, mergeConfig } from 'vitest/config';

const shared = { test: { env: { FROM_CONFIG: 'yes' } } };

// A function, as defineConfig allows, merged with a shared config, as projects split them.
export default defineConfig(() =>
  mergeConfig(shared, {
    resolve: {
      alias: [{ find: /^~\/(.*)$/, replacement: './src/$1' }],
    },
    test: {
      include: ['tests/**/*.check.ts'],
      exclude: [...configDefaults.exclude],
      setupFiles: ['./tests/setup.ts'],
      alias: { '@lib': './src/lib' },
      testTimeout: 1234,
    },
  })
);
