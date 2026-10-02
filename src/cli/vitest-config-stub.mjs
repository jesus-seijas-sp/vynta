// What a vitest config imports from 'vitest/config', served to it while vyntra loads it: the real module loads Vite
// (~170 ms) to give the config an identity function and a few defaults.

export const defaultInclude = ['**/*.{test,spec}.?(c|m)[jt]s?(x)'];
export const defaultExclude = ['**/node_modules/**', '**/.git/**'];
export const defaultBrowserPort = 63315;

export const coverageConfigDefaults = {
  provider: 'v8',
  enabled: false,
  clean: true,
  cleanOnRerun: true,
  reportsDirectory: './coverage',
  exclude: [],
  reportOnFailure: false,
  reporter: [
    ['text', {}],
    ['html', {}],
    ['clover', {}],
    ['json', {}],
  ],
  extension: ['.js', '.cjs', '.mjs', '.ts', '.mts', '.tsx', '.jsx', '.vue', '.svelte', '.marko', '.astro'],
  allowExternal: false,
  excludeAfterRemap: false,
  processingConcurrency: 20,
};

export const configDefaults = Object.freeze({
  allowOnly: true,
  isolate: true,
  watch: false,
  globals: false,
  environment: 'node',
  clearMocks: false,
  restoreMocks: false,
  mockReset: false,
  unstubGlobals: false,
  unstubEnvs: false,
  include: defaultInclude,
  exclude: defaultExclude,
  teardownTimeout: 10000,
  forceRerunTriggers: ['**/package.json/**', '**/{vitest,vite}.config.*/**'],
  update: false,
  reporters: [],
  silent: false,
  hideSkippedTests: false,
  api: false,
  ui: false,
  uiBase: '/__vitest__/',
  open: false,
  css: { include: [] },
  coverage: coverageConfigDefaults,
  fakeTimers: { loopLimit: 10000, shouldClearNativeTimers: true },
  maxConcurrency: 5,
  dangerouslyIgnoreUnhandledErrors: false,
  typecheck: { checker: 'tsc', include: ['**/*.{test,spec}-d.?(c|m)[jt]s?(x)'], exclude: defaultExclude },
  slowTestThreshold: 300,
  disableConsoleIntercept: false,
});

export const defineConfig = (config) => config;
export const defineProject = (config) => config;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// Vite's mergeConfig: objects merged deeply, arrays joined, anything else overridden.
export function mergeConfig(defaults, overrides) {
  const merged = { ...defaults };
  Object.entries(overrides ?? {}).forEach(([key, value]) => {
    if (value === undefined) {
      return;
    }
    const current = merged[key];
    if (Array.isArray(current) || Array.isArray(value)) {
      merged[key] = [...[current ?? []].flat(), ...[value].flat()];
    } else if (isObject(current) && isObject(value)) {
      merged[key] = mergeConfig(current, value);
    } else {
      merged[key] = value;
    }
  });
  return merged;
}
