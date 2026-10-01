const fs = require('node:fs');
const path = require('node:path');
const { runFixture, copyFixture } = require('./helpers/run-fixture');

describe('snapshots', () => {
  const dir = copyFixture('snapshots');
  const snapFile = path.join(dir, '__snapshots__', 'snap.test.js.snap');
  const testFile = path.join(dir, 'snap.test.js');
  const withVersion = (version, args = []) => {
    process.env.SNAPSHOT_VERSION = version;
    try {
      return runFixture(dir, args);
    } finally {
      delete process.env.SNAPSHOT_VERSION;
    }
  };

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writes new snapshots in the format of Jest', () => {
    const report = withVersion('1');
    expect(report.success).toBe(true);
    expect(report.files[0].snapshot).toMatchObject({ added: 7, failed: 0 });
    expect(fs.readFileSync(snapFile, 'utf8')).toBe(
      [
        '// Jest Snapshot v1, https://jestjs.io/docs/snapshot-testing',
        '',
        'exports[`stored matches objects 1`] = `',
        '{',
        '  "list": [',
        '    1,',
        '    "two",',
        '    {',
        '      "three": 3,',
        '    },',
        '  ],',
        '  "map": Map {',
        '    "k" => true,',
        '  },',
        '  "version": "1",',
        '}',
        '`;',
        '',
        // eslint-disable-next-line no-template-curly-in-string -- the snapshot file escapes ${
        'exports[`stored numbers calls and hints 1`] = `"first \\`quoted\\` \\${value}"`;',
        '',
        'exports[`stored numbers calls and hints 2`] = `',
        '{',
        '  "at": 1970-01-01T00:00:00.000Z,',
        '  "id": Any<Number>,',
        '}',
        '`;',
        '',
        'exports[`stored numbers calls and hints: named 1`] = `"second"`;',
        '',
        'exports[`stored snapshots errors 1`] = `"broken 1"`;',
        '',
      ].join('\n')
    );
  });

  it('writes inline snapshots into the test file', () => {
    const source = fs.readFileSync(testFile, 'utf8');
    expect(source).toContain(
      [
        '    expect({ a: 1, b: [version] }).toMatchInlineSnapshot(`',
        '      {',
        '        "a": 1,',
        '        "b": [',
        '          "1",',
        '        ],',
        '      }',
        '    `);',
        '    expect(\'one line\').toMatchInlineSnapshot(`"one line"`);',
      ].join('\n')
    );
  });

  it('matches what it wrote', () => {
    const report = withVersion('1');
    expect(report.success).toBe(true);
    expect(report.files[0].snapshot).toMatchObject({ added: 0, matched: 7, failed: 0 });
  });

  it('fails when a value changes, with a diff', () => {
    const report = withVersion('2');
    expect(report.success).toBe(false);
    expect(report.files[0].snapshot.failed).toBe(3);
    expect(report.tests['stored > matches objects'].errors[0].message).toContain(
      '-   "version": "1",\n+   "version": "2",'
    );
  });

  it('updates snapshots with -u', () => {
    expect(withVersion('2', ['-u']).files[0].snapshot).toMatchObject({ updated: 3, failed: 0 });
    expect(withVersion('2').success).toBe(true);
    expect(fs.readFileSync(testFile, 'utf8')).toContain('"2",');
  });
});
