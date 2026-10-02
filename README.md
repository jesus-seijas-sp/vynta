# vyntra

A very fast test runner for Node.js with the API of Jest and Vitest, and no dependencies.

Test suites written for Jest or Vitest run unchanged: `describe`/`it`/`expect`, `jest.*` and `vi.*` are globals,
and `import ... from 'vitest'` or `'@jest/globals'` resolve to vyntra.

```sh
npx vyntra                  # every *.test.* / *.spec.* / __tests__ file
npx vyntra src/user -t save # files matching src/user, tests whose name matches "save"
npx vyntra --coverage       # with V8 coverage
```

## Speed

Measured on [schiva](https://github.com/jesus-seijas-sp/schiva) (39 files, 981 tests, CommonJS), unchanged test
files, Node.js 22.21, Windows 11, i7-13700H, median of 7 runs of the whole command with the runners taking turns:

| Runner                  |  Wall time | With coverage |
| ----------------------- | ---------: | ------------: |
| **vyntra 0.3**          | **0.90 s** |    **1.31 s** |
| Vitest 5.0              |     2.30 s |        3.44 s |
| Vitest 5.0 --no-isolate |     1.86 s |             - |
| Jest 30.5               |     4.91 s |        6.59 s |

On the test suites of open-source projects, run as their repositories have them (no file changed, vyntra reading
the project's own `vitest.config.mts` or `jest.config.js`), the runners taking turns:

| Project                                             | Suite                                                         |     vyntra |       Other runner | Same results                       |
| --------------------------------------------------- | ------------------------------------------------------------- | ---------: | -----------------: | ---------------------------------- |
| [NestJS](https://github.com/nestjs/nest) `7fb52e7`  | 305 files, 3,701 tests, TypeScript with decorator metadata    |  **8.9 s** | Vitest 5.0: 34.9 s | Yes, and one file more (see below) |
| [Strapi](https://github.com/strapi/strapi) `bc653e8` | 22 packages, 5,924 tests, TypeScript through `@swc/jest`      | **50.1 s** | Jest 29.6: 126.0 s | Yes, but 3 tests (see below)       |
| [Yarn](https://github.com/yarnpkg/berry) `e4e423a`  | 44 files, 949 tests, TypeScript, Jest transformer, PnP        | **11.9 s** |  Jest 29.2: 19.9 s | Yes, test by test                  |

- NestJS: median of 5 runs; 11.3 s with vyntra's compile cache emptied first. Both runners fail 4 files that import
  packages missing from the install measured; Vitest loses one more on Windows, where a test sending `SIGTERM` to
  its own process ends the Vitest worker running it.
- Strapi: each package's unit suite, one after the other, median of 3 rounds, after `yarn build`; vyntra with
  `--pool forks`. Two tests of `core/upload` expect what Jest does, which can not run the `import()` of an ES
  module, and one of `core/core` needs `NODE_ENV=test`, which Jest sets and vyntra does not.
- Yarn: median of 5 runs; both commands start through Yarn (`yarn jest`, `yarn node vyntra`), about 2.8 s of each
  run. With `--splitFiles`, which runs the slowest file (Yarn's shell, hundreds of processes) in parts, vyntra
  takes 9.1 s.

The details are on the [benchmarks page](docs/benchmarks.html). Run it on your project with
`node bench/compare.js <runs> 'name=command' ...`.

Where the time goes, and what vyntra does instead:

- **No transform pipeline.** Jest runs every file through Babel, Vitest through Vite. vyntra loads files with Node.js
  itself (`require`, `import`, and Node's own type stripping for TypeScript), and compiles only what Node.js can not
  run: decorators, JSX, or what the project's Jest `transform` asks for, kept on disk between runs. Mock hoisting is a
  small scanner that runs only on files calling `vi.mock()`/`jest.mock()`.
- **Warm workers, cheap isolation.** Worker threads are reused between files. Isolation between files drops the
  project modules from the cache (ES modules get a fresh copy through a query string) but keeps `node_modules`
  loaded, instead of starting a new worker or VM context per file.
- **Scheduling from the last run.** Durations are kept in `node_modules/.cache/vyntra`; files start slowest first and
  are handed to whichever worker is free. The number of workers is just enough for the slowest file to be the whole
  run: on schiva 5 workers finish sooner than 19, which only add startup and contention for the cores.
- **Only failures cost.** Assertions build nothing when they pass; messages, diffs and code frames are made when one
  fails.
- **Coverage from V8.** No instrumentation: V8 counts executed blocks (`Profiler.startPreciseCoverage`) and the report
  is built at the end.

## Compatibility

| Area         | Supported                                                                                                                                                                                                                                                                                                                                            |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tests        | `describe`/`suite`, `it`/`test`, `.skip`, `.only`, `.todo`, `.each` (arrays, objects, tagged templates), `.for`, `.concurrent`, `.sequential`, `.fails`/`.failing`, `.skipIf`, `.runIf`, `test.extend` fixtures, `done` callbacks, test context (`task`, `skip`, `expect`, `signal`, `onTestFinished`, `onTestFailed`), timeouts, `retry`, `repeats` |
| Hooks        | `beforeAll`, `afterAll`, `beforeEach` (returning a cleanup), `afterEach`, in Vitest's order, or Jest's with a Jest config |
| expect       | Every Jest matcher and the Vitest ones (`toBeTypeOf`, `toBeOneOf`, `toSatisfy`, `toHaveBeenCalledOnce`...), `.not`, `.resolves`, `.rejects`, asymmetric matchers, `expect.extend`, `expect.soft`, `expect.poll`, `expect.assertions`, `expect.hasAssertions`, `expect.addEqualityTesters`                                                            |
| Snapshots    | `toMatchSnapshot` (property matchers, hints), `toMatchInlineSnapshot` (written into the source), `toThrowErrorMatching(Inline)Snapshot`, `-u`, `--ci`, `expect.addSnapshotSerializer`. `.snap` files of Jest and Vitest are read and written in their own format                                                                                     |
| Mocks        | `vi.fn`/`jest.fn` and every `mock*` method, `spyOn` (methods, getters, setters, classes), `clearAllMocks`, `resetAllMocks`, `restoreAllMocks`, `stubGlobal`, `stubEnv`, `waitFor`, `waitUntil`, Chai style (`expect(x).to.equal(1)`, `to.have.been.calledWith`)                                                                                                                                                       |
| Module mocks | `vi.mock`/`jest.mock` hoisted in CommonJS and ES modules, factories (async in ESM, with `importOriginal`), automock, `__mocks__` manual mocks, virtual modules, `vi.hoisted`, `doMock`, `unmock`, `requireActual`, `importActual`, `requireMock`, `importMock`, `isolateModules`, `resetModules`, `dontMock`, `deepUnmock`, builtins (`vi.mock('fs')`)                                                     |
| Fake timers  | `useFakeTimers` (timeouts, intervals, immediates, `Date`, `performance.now`), `advanceTimersByTime(Async)`, `runAllTimers(Async)`, `runOnlyPendingTimers(Async)`, `advanceTimersToNextTimer`, `setSystemTime`, `getTimerCount`                                                                                                                       |
| Files        | CommonJS, ES modules, TypeScript (`.ts`/`.mts`/`.cts`, Node.js type stripping), JSX and decorators (with the project's esbuild, sucrase or TypeScript), Jest `transform`, setup files                                                                                                                                                                                                                                                          |
| Imports      | What bundlers accept: JSON without `with { type: 'json' }`, stylesheets (a CSS-module stub) and images (their path), `import.meta.glob`, imports without extension or of a folder's `index`, `./file.js` naming `file.ts`, `moduleNameMapper` and Vite aliases, named imports of CommonJS packages, `__dirname`/`require` in compiled ES modules, Yarn PnP |
| Isolation    | Between the files of a worker: project modules, `process.env`, globals (even non-configurable ones), mocks, and the dependencies a mocking file loaded |
| Config       | `vyntra.config.js`, `"vyntra"` in package.json, the project's Vitest config (`vitest.config.*`, or `vite.config.*` with `test`) or Jest config (`jest.config.*` / `"jest"`)                                                                                                                                                                                                                                              |
| Coverage     | Text table and `lcov.info` like Jest, `collectCoverageFrom`, `coverageThreshold`                                                                                                                                                                                                                                                                     |

Environments: Node.js, and `jsdom` or `happy-dom` (the project's own), for the whole run or per file
(`@vitest-environment` / `@jest-environment` comments).

Code that needs a process of its own (`process.chdir`, native addons that are not thread safe) runs with
`--pool forks`. In worker threads `process.send` exists, as it does in Jest's child processes. On Windows, a worker
thread that loaded some native addons together (SQLite's and swc's) can crash the run when it ends: use
`--pool forks` there.

Differences with Jest and Vitest: `NODE_ENV` is left as it is (they set it to `test`; set it yourself, or
`env: { NODE_ENV: 'test' }` in `vyntra.config.js`), `import()` of ES modules works from CommonJS (Jest can not
run it without `--experimental-vm-modules`), and stack traces of compiled files show the compiled lines.

Not available yet: watch mode, Jest and Vitest `projects` in one run, `globalSetup`/`globalTeardown`, custom test
environments (a Jest `testEnvironment` module) and `testEnvironmentOptions`, Babel without a `transform`,
asynchronous transformers and Vite `resolveId`/`load` hooks, source maps in stack traces, named imports from JSON,
`import.meta.env`, type checking, sharding, coverage of files no test loads.

## CLI

```
-t, --testNamePattern <regex>  Run only the tests whose full name matches
-c, --config <file>            Config file (default: vyntra.config.js, or the Vitest or Jest config)
-r, --root <dir>               Project root (default: current directory)
-w, --maxWorkers <n|n%>        Worker threads (default: from the last run)
-i, --runInBand                Run every file in the main thread
    --pool <threads|forks|inline>  Worker threads (default), child processes like Jest, or the main thread
    --no-isolate               Share project modules between files (faster, less isolated)
    --testTimeout <ms>         Default timeout of tests (default: 5000)
    --reporter <default|verbose|json>
    --retry <n>                Retry failing tests
    --bail <n>                 Stop after n failed files
    --silent                   Do not print console output of tests
    --passWithNoTests          Do not fail when no test files are found
-u, --update                   Update snapshots
    --coverage                 Report the coverage of the project files (V8)
    --coverageDirectory <dir>  Where coverage reports go (default: coverage; vitest's --coverage.reportsDirectory too)
    --ci                       Do not write new snapshots
```

Positional arguments filter the test files by path, as in Jest.

## Config

```js
// vyntra.config.js
module.exports = {
  include: ["**/*.{test,spec}.?(c|m)[jt]s?(x)"],
  exclude: ["**/node_modules/**", "**/dist/**"],
  setupFiles: ["./test/setup.js"],
  testTimeout: 5000,
  isolate: true,
  restoreMocks: true,
  coverageThreshold: { global: { lines: 90 } },
};
```

## Layout

```
bin/vyntra.js         CLI entry
src/cli/             arguments, config, discovery, worker pool, reporters
src/collect/         describe/it and the suite tree
src/run/             running a file: hooks, timeouts, retries, fixtures
src/expect/          expect, matchers, equality, formatting, diffs
src/mock/            vi.fn, spyOn
src/modules/         vi.mock: scanner, hoisting, registry, loader hooks
src/snapshot/        snapshot files and inline snapshots
src/timers/          fake timers
src/coverage/        V8 coverage and its reports
```
