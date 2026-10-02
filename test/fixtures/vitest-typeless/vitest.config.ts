// A package with no "type", whose config is an ES module that uses __dirname, as Strapi's do.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: __dirname,
    include: ['tests/**/*.check.ts'],
  },
});
