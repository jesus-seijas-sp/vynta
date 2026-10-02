const path = require('node:path');
const { formatTitle, normalizeTable } = require('../src/collect/each');
const { parseCli } = require('../src/cli/args');
const { Reporter } = require('../src/cli/reporter');
const { globToRegExp } = require('../src/cli/glob');
const { diffLines } = require('../src/expect/diff');
const { format } = require('../src/expect/format');
const { configure: configureResolution } = require('../src/resolve-paths');
const { markTypeImports } = require('../src/type-imports');
const { fromVitestConfig } = require('../src/cli/vitest-config');
const { SnapshotState } = require('../src/snapshot/snapshot-state');
const { loadConfig } = require('../src/cli/config');

describe('each titles', () => {
  // As it.each(rows)(name).
  const title = (name, rows) => normalizeTable([rows]).map((row, i) => formatTitle(name, row, i));

  it('formats printf placeholders', () => {
    expect(title('%s %d %i %f %j %p %# %$ %%', [['a', 1.5, 2.7, '3', { a: 1 }, 'p']])).toEqual([
      'a 1.5 2 3 {"a":1} "p" 0 1 %',
    ]);
  });

  it('interpolates $keys of object cases', () => {
    expect(title('$a.b and $c', [{ a: { b: 1 }, c: 'x' }])).toEqual(['1 and "x"']);
  });

  it('takes single values as one argument', () => {
    expect(title('value %s', [1, 2])).toEqual(['value 1', 'value 2']);
  });
});

describe('glob', () => {
  it.each([
    ['**/*.test.js', 'a/b/c.test.js', true],
    ['**/*.test.js', 'c.test.js', true],
    ['**/*.test.js', 'c.test.jsx', false],
    ['src/*.js', 'src/a/b.js', false],
    ['*.{js,ts}', 'a.ts', true],
    ['**/*.?(c|m)[jt]s', 'a.mjs', true],
    ['**/*.?(c|m)[jt]s', 'a.xjs', false],
    ['**/__tests__/**', 'src/__tests__/a/b.js', true],
  ])('%s matches %s: %s', (glob, file, result) => {
    expect(globToRegExp(glob).test(file)).toBe(result);
  });
});

describe('diffLines', () => {
  it('finds the shortest edit script', () => {
    expect(diffLines(['a', 'b', 'c'], ['a', 'x', 'c', 'd'])).toEqual([
      [' ', 'a'],
      ['-', 'b'],
      ['+', 'x'],
      [' ', 'c'],
      ['+', 'd'],
    ]);
    expect(diffLines([], [])).toEqual([]);
  });
});

describe('format', () => {
  it('prints values like pretty-format', () => {
    expect(format({ b: [1, 'x'], a: new Map([[1, new Set([2])]]) })).toBe(
      '{\n  "a": Map {\n    1 => Set {\n      2,\n    },\n  },\n  "b": [\n    1,\n    "x",\n  ],\n}'
    );
    expect(format({ a: [1, { b: 2 }] }, { min: true })).toBe('{"a": [1, {"b": 2}]}');
    expect(format([-0, 1n, undefined, null, Symbol('s')], { min: true })).toBe('[-0, 1n, undefined, null, Symbol(s)]');
  });

  it('prints circular references, classes and errors', () => {
    class Box {
      constructor() {
        this.self = this;
      }
    }
    expect(format(new Box(), { min: true })).toBe('Box {"self": [Circular]}');
    expect(format(new TypeError('bad'))).toBe('[TypeError: bad]');
    expect(format(expect.any(Number))).toBe('Any<Number>');
  });
});

describe('looksLikeJsx', () => {
  // eslint-disable-next-line global-require
  const { looksLikeJsx } = require('../src/transform');

  it('finds JSX in code', () => {
    expect(looksLikeJsx('const a = <div>hi</div>;')).toBe(true);
    expect(looksLikeJsx(['function App() {', '  return <Button label="x" />;', '}'].join('\n'))).toBe(true);
    expect(looksLikeJsx(['render(<>', '  <A />', '</>);'].join('\n'))).toBe(true);
  });

  it('ignores HTML in strings, templates and comments', () => {
    expect(looksLikeJsx("const a = '<script>alert(1)</script>';")).toBe(false);
    // eslint-disable-next-line no-template-curly-in-string -- source code given as a string
    expect(looksLikeJsx('const b = `<strong>${name}</strong>`;')).toBe(false);
    expect(looksLikeJsx(['// returns <div> markup', 'const c = 1;'].join('\n'))).toBe(false);
    expect(looksLikeJsx("res.send('Not found <script>x</script>');")).toBe(false);
  });
});

describe('parseCli', () => {
  it('takes the coverage directory, in the flag of Jest or of vitest', () => {
    expect(parseCli(['--coverage', '--coverageDirectory', 'out/cov']).options).toMatchObject({
      coverage: true,
      coverageDirectory: 'out/cov',
    });
    expect(parseCli(['--coverage.reportsDirectory=reports']).options.coverageDirectory).toBe('reports');
  });

  it('does not take the directory for a path pattern', () => {
    expect(parseCli(['--coverageDirectory', 'out/cov', 'src/']).patterns).toEqual(['src/']);
  });
});

describe('console output of a file', () => {
  const result = {
    path: '/project/a.test.js',
    errors: [],
    tests: [
      { name: 'passes', status: 'passed' },
      { name: 'fails', status: 'failed' },
    ],
    console: [
      { type: 'log', test: 'passes', text: 'FROM-PASSING' },
      { type: 'log', test: 'fails', text: 'FROM-FAILING' },
    ],
  };
  const printed = (silent) => {
    let text = '';
    const reporter = new Reporter(
      { rootDir: '/project', silent, colors: false },
      {
        write: (chunk) => {
          text += chunk;
        },
      }
    );
    reporter.printConsole(result, true);
    return text;
  };

  it('is printed for every test by default', () => {
    expect(printed(false)).toContain('FROM-PASSING');
    expect(printed(false)).toContain('FROM-FAILING');
  });

  it("is only printed for failing tests with silent: 'passed-only', as in vitest", () => {
    expect(printed('passed-only')).not.toContain('FROM-PASSING');
    expect(printed('passed-only')).toContain('FROM-FAILING');
  });
});

describe('markTypeImports', () => {
  const root = path.join(__dirname, 'fixtures', 'typescript');
  const file = path.join(root, 'imports.test.ts');
  configureResolution({ rootDir: root, moduleFileExtensions: ['js', 'ts'] });

  it('marks the names a project module only declares as types', () => {
    expect(markTypeImports("import { area, Options } from './lib.js';", file)).toBe(
      "import { area, type Options } from './lib.js';"
    );
  });

  it('leaves values, packages and names it does not know alone', () => {
    const source = "import { area } from './lib.js';\nimport { plain } from 'cjs-reserved';";
    expect(markTypeImports(source, file)).toBe(source);
  });
});

describe('fromVitestConfig', () => {
  const root = path.resolve('/project');

  it('takes the options vitest names differently', () => {
    const config = fromVitestConfig(
      {
        test: {
          pool: 'vmForks',
          mockReset: true,
          sequence: { hooks: 'list' },
          setupFiles: './setup.ts',
          coverage: {
            enabled: true,
            reporter: ['text', ['lcov', {}]],
            reportsDirectory: 'cov',
            include: ['src/**'],
            exclude: ['src/gen/**'],
            thresholds: { lines: 80, branches: 70 },
          },
        },
        oxc: { decorator: { legacy: true, emitDecoratorMetadata: true } },
      },
      root
    );
    expect(config).toEqual({
      pool: 'forks',
      resetMocks: true,
      hookOrder: 'list',
      setupFiles: [path.join(root, 'setup.ts')],
      coverage: true,
      coverageReporters: ['text', 'lcov'],
      coverageDirectory: 'cov',
      collectCoverageFrom: ['src/**', '!src/gen/**'],
      coverageThreshold: { global: { lines: 80, branches: 70 } },
      compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true },
    });
  });

  it('resolves relative alias replacements from the root and keeps package names', () => {
    const { alias } = fromVitestConfig({ test: { alias: { '@app': './src', react: 'preact/compat' } } }, root);
    expect(alias).toEqual([
      { find: '@app', replacement: path.join(root, 'src') },
      { find: 'react', replacement: 'preact/compat' },
    ]);
  });
});

describe('snapshot serialization', () => {
  it('stores line breaks as \\n, as Jest does, whatever the system wrote', () => {
    const snapshots = new SnapshotState(path.join(__dirname, 'none.test.js'));
    expect(snapshots.serialize('a\r\nb\rc')).toBe('"a\nb\nc"');
  });
});

describe('testMatch of a Jest config', () => {
  it('keeps the directories of patterns that match anywhere, and drops <rootDir>/', async () => {
    const root = path.join(__dirname, 'fixtures', 'jest-preset');
    const config = await loadConfig({ rootDir: root, config: 'jest.config.unit.js' });
    expect(config.include).toEqual(['**/tests/**/*.check.js']);
  });
});
