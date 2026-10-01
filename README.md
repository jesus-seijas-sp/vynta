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
files, Node.js 22.21, Windows 11, i7-13700H, median of 7 runs of the whole command:

| Runner                  |  Wall time | With coverage |
| ----------------------- | ---------: | ------------: |
| **vyntra**               | **0.68 s** |    **1.12 s** |
| Vitest 5.0              |     1.83 s |        2.89 s |
| Vitest 5.0 --no-isolate |     1.58 s |             - |
| Jest 30                 |     3.76 s |        5.18 s |

Run it on your project with `node bench/compare.js <runs> 'name=command' ...`.

Where the time goes, and what vyntra does instead:

- **No transform pipeline.** Jest runs every file through Babel, Vitest through Vite. vyntra loads files with Node.js
  itself (`require`, `import`, and Node's own type stripping for TypeScript). Mock hoisting, the only transform tests
  need, is a small scanner that runs only on files calling `vi.mock()`/`jest.mock()`.
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
| Hooks        | `beforeAll`, `afterAll`, `beforeEach` (returning a cleanup), `afterEach`, in Jest's order                                                                                                                                                                                                                                                            |
| expect       | Every Jest matcher and the Vitest ones (`toBeTypeOf`, `toBeOneOf`, `toSatisfy`, `toHaveBeenCalledOnce`...), `.not`, `.resolves`, `.rejects`, asymmetric matchers, `expect.extend`, `expect.soft`, `expect.poll`, `expect.assertions`, `expect.hasAssertions`, `expect.addEqualityTesters`                                                            |
| Snapshots    | `toMatchSnapshot` (property matchers, hints), `toMatchInlineSnapshot` (written into the source), `toThrowErrorMatching(Inline)Snapshot`, `-u`, `--ci`, `expect.addSnapshotSerializer`. `.snap` files of Jest and Vitest are read and written in their own format                                                                                     |
| Mocks        | `vi.fn`/`jest.fn` and every `mock*` method, `spyOn` (methods, getters, setters, classes), `clearAllMocks`, `resetAllMocks`, `restoreAllMocks`, `stubGlobal`, `stubEnv`, `waitFor`, `waitUntil`                                                                                                                                                       |
| Module mocks | `vi.mock`/`jest.mock` hoisted in CommonJS and ES modules, factories (async in ESM, with `importOriginal`), automock, `__mocks__` manual mocks, virtual modules, `vi.hoisted`, `doMock`, `unmock`, `requireActual`, `importActual`, `requireMock`, `importMock`, `isolateModules`, `resetModules`                                                     |
| Fake timers  | `useFakeTimers` (timeouts, intervals, immediates, `Date`, `performance.now`), `advanceTimersByTime(Async)`, `runAllTimers(Async)`, `runOnlyPendingTimers(Async)`, `advanceTimersToNextTimer`, `setSystemTime`, `getTimerCount`                                                                                                                       |
| Files        | CommonJS, ES modules, TypeScript (`.ts`/`.mts`/`.cts`, Node.js type stripping), setup files                                                                                                                                                                                                                                                          |
| Config       | `vyntra.config.js`, `"vyntra"` in package.json, or the project's Jest config (`jest.config.*` / `"jest"`)                                                                                                                                                                                                                                              |
| Coverage     | Text table and `lcov.info` like Jest, `collectCoverageFrom`, `coverageThreshold`                                                                                                                                                                                                                                                                     |

Code that needs a process of its own (`process.chdir`, native addons that are not thread safe) runs with
`--pool forks`. In worker threads `process.send` exists, as it does in Jest's child processes.

Not available yet: watch mode, browser-like environments (`jsdom`, `happy-dom`), JSX, type checking, sharding,
coverage of files no test loads.

## CLI

```
-t, --testNamePattern <regex>  Run only the tests whose full name matches
-c, --config <file>            Config file (default: vyntra.config.js, or the Jest config)
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
