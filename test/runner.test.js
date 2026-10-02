const { runFixture } = require('./helpers/run-fixture');

describe('modes', () => {
  const { statuses, tests } = runFixture('modes');

  it('reports passing, failing, skipped and todo tests', () => {
    expect(statuses['plain > passes']).toBe('passed');
    expect(statuses['plain > fails']).toBe('failed');
    expect(statuses['plain > is skipped']).toBe('skipped');
    expect(statuses['plain > is todo']).toBe('todo');
    expect(statuses['skipped describe > inside']).toBe('skipped');
  });

  it('inverts .fails', () => {
    expect(statuses['plain > fails as expected']).toBe('passed');
    expect(statuses['plain > passes unexpectedly']).toBe('failed');
  });

  it('applies skipIf, runIf and context.skip()', () => {
    expect(statuses['plain > skipIf true']).toBe('skipped');
    expect(statuses['plain > runIf true']).toBe('passed');
    expect(statuses['plain > skips itself']).toBe('skipped');
  });

  it('names and runs each cases', () => {
    expect(statuses['each > 1 + 2 = 3']).toBe('passed');
    expect(statuses['each > 2 + 2 = 4']).toBe('passed');
    expect(statuses['each > "ann" is 3']).toBe('passed');
    expect(statuses['each > template 1 + 1']).toBe('passed');
    expect(statuses['each > for 5 5']).toBe('passed');
    expect(statuses['each > describe x > has the letter']).toBe('passed');
    expect(statuses['each > describe y > has the letter']).toBe('passed');
  });

  it('handles done callbacks, timeouts and uncaught errors', () => {
    expect(statuses['async > done callback']).toBe('passed');
    expect(tests['async > done with error'].errors[0].message).toBe('given to done');
    expect(tests['async > times out'].errors[0].message).toMatch(/^Test timed out in 50ms/);
    expect(tests['async > uncaught error'].errors[0].message).toBe('uncaught');
    expect(tests['async > unawaited rejects'].errors[0].message).toMatch(
      /Received promise resolved instead of rejected/
    );
  });

  it('checks expect.assertions and expect.hasAssertions', () => {
    expect(statuses['assertion counts > assertions ok']).toBe('passed');
    expect(tests['assertion counts > assertions wrong'].errors[0].message).toMatch(/Expected 2 assertions/);
    expect(statuses['assertion counts > hasAssertions']).toBe('failed');
  });

  it('retries', () => {
    expect(statuses['retry > passes on the third attempt']).toBe('passed');
    expect(tests['retry > passes on the third attempt'].retries).toBe(2);
  });
});

describe('hooks', () => {
  const { statuses, tests } = runFixture('hooks');

  it('runs hooks and beforeEach cleanups in the order of Jest', () => {
    expect(tests['order > is the order of Jest'].errors).toEqual([]);
  });

  it('fails the tests of a suite whose beforeAll throws', () => {
    expect(statuses['failing beforeAll > is failed by its beforeAll']).toBe('failed');
    expect(tests['failing beforeAll > is failed by its beforeAll'].errors[0].message).toBe('beforeAll broke');
  });
});

describe('only', () => {
  it('runs only the .only tests and describes of the file', () => {
    expect(runFixture('only').statuses).toEqual({
      'group > not only': 'skipped',
      'group > only test': 'passed',
      'only describe > runs': 'passed',
      'top level not only': 'skipped',
    });
  });
});

describe('vitest context', () => {
  it('supports imports from vitest, fixtures, the test context and concurrent tests', () => {
    const { statuses, tests } = runFixture('context');
    const failures = Object.entries(tests).filter(([, test]) => test.status !== 'passed');
    expect(failures).toEqual([]);
    expect(Object.keys(statuses)).toHaveLength(6);
  });
});

describe('test name pattern', () => {
  it('skips the tests whose full name does not match', () => {
    const { statuses } = runFixture('only', ['-t', 'only test']);
    expect(statuses['group > only test']).toBe('passed');
    expect(statuses['only describe > runs']).toBe('skipped');
  });
});

describe('module mocking', () => {
  it.each([[[]], [['-i']]])('mocks CommonJS and ES modules without leaking between files (%j)', (args) => {
    const { statuses } = runFixture('mocking', args);
    expect(Object.values(statuses)).toHaveLength(15);
    expect(Object.entries(statuses).filter(([, status]) => status !== 'passed')).toEqual([]);
  });
});

describe('pools', () => {
  it('runs the files in child processes with --pool forks', () => {
    const { statuses } = runFixture('hooks', ['--pool', 'forks']);
    expect(statuses['order > is the order of Jest']).toBe('passed');
  });

  it('gives worker threads a process.send, as code run by Jest has one', () => {
    const { statuses } = runFixture('process');
    expect(statuses['process.send exists']).toBe('passed');
  });
});

describe('signals', () => {
  it("gives a signal a file sends to its own process to the file's listener, not to the whole run", () => {
    const { statuses } = runFixture('process');
    expect(statuses['a signal sent to the own process reaches its listener']).toBe('passed');
  });
});

describe('json files', () => {
  // One worker: the CommonJS test runs after the ES module one, when require() goes through the loader hooks.
  const { statuses } = runFixture('json', ['--maxWorkers', '1']);

  it('gives module.exports to a require() of CommonJS that an ES module imported', () => {
    expect(statuses['json > is module.exports for a require of CommonJS an ES module imported']).toBe('passed');
  });

  it('gives module.exports to a require() after an ES module ran in the worker', () => {
    expect(statuses['json from commonjs > is the object for a require of a CommonJS test']).toBe('passed');
  });

  it('gives the default export to imports, with or without { type: json }', () => {
    expect(statuses['json > is the default export for an import without attributes']).toBe('passed');
    expect(statuses['json > is the default export for an import with { type: json }']).toBe('passed');
  });
});

describe('typescript projects', () => {
  const { statuses } = runFixture('typescript');

  it('resolves an import of ./lib.js to lib.ts', () => {
    expect(statuses['typescript > imports ./lib.js from lib.ts, as TypeScript projects write it']).toBe('passed');
  });

  it('imports names of a CommonJS package that are reserved words in a declaration', () => {
    expect(statuses['typescript > imports names of a CommonJS package that are reserved words']).toBe('passed');
  });
});

describe('vitest config', () => {
  const { statuses } = runFixture('vitest-config');

  it('is read when there is no vyntra config: include, setup files, env and aliases', () => {
    expect(statuses['vitest config > runs the files its include names']).toBe('passed');
    expect(statuses['vitest config > resolves test.alias and resolve.alias']).toBe('passed');
    expect(statuses['vitest config > runs its setup files and sets its env']).toBe('passed');
  });

  it('reaches the workers', () => {
    expect(statuses['has the aliases and env of the config in a worker too']).toBe('passed');
  });
});

describe('jest transform', () => {
  const { statuses, files } = runFixture('jest-transform');

  it("compiles with the project's transformer, made with its options", () => {
    expect(statuses['compiles the project files with its Jest transformer']).toBe('passed');
  });

  it("gives tests Jest's snapshotState._updateSnapshot", () => {
    expect(statuses["tells Jest's snapshot mode to tests that read it"]).toBe('passed');
  });

  it('leaves out the files under modulePathIgnorePatterns', () => {
    expect(files).toHaveLength(1);
  });
});

describe('worker stdio', () => {
  it("lets a child process take the test's own stdin and stdout", () => {
    const { statuses } = runFixture('process');
    expect(statuses["a child process can be given the test's own stdin and stdout"]).toBe('passed');
  });
});

describe('jest preset', () => {
  it("applies the preset of a config given with --config, the config's setup files after its own", () => {
    const { statuses } = runFixture('jest-preset', ['--config', 'jest.config.unit.js']);
    expect(statuses['runs the files the preset matches, with its setup files before the config ones']).toBe('passed');
  });
});

describe('vitest config in a package with no type', () => {
  it('loads it as Vite would: an ES module with __dirname, and no warning from Node', () => {
    const { statuses } = runFixture('vitest-typeless');
    expect(statuses['reads a config that uses __dirname in a package with no type']).toBe('passed');
  });
});

describe('isolation between files of one thread', () => {
  const { statuses, tests, files } = runFixture('isolation', ['--maxWorkers', '1']);

  it('gives each file the env, packages and globals a fresh Jest file would have', () => {
    // first.test.js and second.test.js: the same test, run one after the other in the same thread.
    const fresh = files
      .flatMap((file) => file.tests)
      .filter((test) => test.path.at(-1).startsWith('starts with what a fresh file has'));
    expect(fresh.map((test) => test.status)).toEqual(['passed', 'passed']);
  });

  it('mocks the dependencies of a module given by requireActual', () => {
    expect(statuses['requireActual gives the real module, whose own dependencies still get their mocks']).toBe(
      'passed'
    );
  });

  it('does not count a rejection handled after fake timers ran', () => {
    expect(statuses['a rejection handled after fake timers ran is not an unhandled one']).toBe('passed');
  });

  it('runs a fake timeout of 0 on advanceTimersByTime(0)', () => {
    expect(statuses['a timeout of 0 runs with advanceTimersByTime(0), as with sinon']).toBe('passed');
  });

  it('gives each value of a table that is not all arrays as one argument', () => {
    const rows = Object.keys(tests).filter((name) => name.startsWith('a table that is not all arrays'));
    expect(rows).toHaveLength(3);
  });

  it('applies jest.doMock and jest.dontMock in a file without jest.mock', () => {
    expect(statuses['jest.doMock and jest.dontMock work without a jest.mock in the file']).toBe('passed');
  });
});

describe('unawaited assertions under a Jest config', () => {
  it('drops one whose promise never settles, as Jest does, without waiting', () => {
    const { statuses } = runFixture('jest-preset', ['--config', 'jest.config.unit.js']);
    expect(statuses['drops an assertion it did not await whose promise never settles, as Jest does']).toBe('passed');
  });
});
