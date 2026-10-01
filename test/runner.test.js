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
    expect(Object.values(statuses)).toHaveLength(14);
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
