const { parseArgs } = require('node:util');

// Jest and vitest flag names are both accepted, so existing scripts keep working.
const OPTIONS = {
  config: { type: 'string', short: 'c' },
  root: { type: 'string', short: 'r' },
  testNamePattern: { type: 'string', short: 't' },
  silent: { type: 'boolean' },
  isolate: { type: 'boolean' },
  'no-isolate': { type: 'boolean' },
  pool: { type: 'string' },
  runInBand: { type: 'boolean', short: 'i' },
  maxWorkers: { type: 'string', short: 'w' },
  testTimeout: { type: 'string' },
  reporter: { type: 'string' },
  verbose: { type: 'boolean' },
  bail: { type: 'string' },
  retry: { type: 'string' },
  allowOnly: { type: 'boolean' },
  passWithNoTests: { type: 'boolean' },
  update: { type: 'boolean', short: 'u' },
  color: { type: 'boolean' },
  'no-color': { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
  coverage: { type: 'boolean' },
  coverageDirectory: { type: 'string' },
  'coverage.reportsDirectory': { type: 'string' },
  splitFiles: { type: 'boolean' },
  ci: { type: 'boolean' },
  watch: { type: 'boolean' },
  // Accepted for compatibility, nothing to do.
  run: { type: 'boolean' },
};

const USAGE = `Usage: vyntra [options] [path patterns...]

Options:
  -t, --testNamePattern <regex>  Run only the tests whose full name matches
  -c, --config <file>            Config file (default: vyntra.config.js, or the Vitest or Jest config)
  -r, --root <dir>               Project root (default: current directory)
  -w, --maxWorkers <n|n%>        Worker threads (default: cores - 1)
  -i, --runInBand                Run every file in the main thread
      --pool <threads|forks|inline>  Worker threads (default), child processes like Jest, or the main thread
      --no-isolate               Share project modules between files (faster, less isolated)
      --testTimeout <ms>         Default timeout of tests (default: 5000)
      --reporter <default|verbose>
      --retry <n>                Retry failing tests
      --bail <n>                 Stop after n failed files
      --silent                   Do not print console output of tests
      --passWithNoTests          Do not fail when no test files are found
  -u, --update                   Update snapshots
      --coverage                 Report the coverage of the project files (V8)
      --coverageDirectory <dir>  Where coverage reports go (default: coverage; vitest's --coverage.reportsDirectory too)
      --splitFiles               Run long files in parts on several workers (their tests must be independent)
      --ci                       Do not write new snapshots
  -h, --help                     Show this help
`;

const toNumber = (value) => (value === undefined ? undefined : Number(value));

// CLI arguments as config options (only the ones given) plus the positional patterns.
function parseCli(argv) {
  const { values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: false });
  const options = {
    config: values.config,
    rootDir: values.root,
    testNamePattern: values.testNamePattern,
    silent: values.silent,
    pool: values.runInBand ? 'inline' : values.pool,
    maxWorkers: values.maxWorkers,
    testTimeout: toNumber(values.testTimeout),
    reporter: values.verbose ? 'verbose' : values.reporter,
    bail: toNumber(values.bail),
    retry: toNumber(values.retry),
    allowOnly: values.allowOnly,
    passWithNoTests: values.passWithNoTests,
    update: values.update,
    coverage: values.coverage,
    coverageDirectory: values.coverageDirectory ?? values['coverage.reportsDirectory'],
    splitFiles: values.splitFiles,
    ci: values.ci,
    isolate: values['no-isolate'] ? false : values.isolate,
    colors: values['no-color'] ? false : values.color,
  };
  const given = Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined));
  // "jest ." means every file: a pattern that matches everything is no filter.
  const patterns = positionals.filter((pattern) => pattern !== '.' && pattern !== './');
  return { options: given, patterns, help: values.help, version: values.version, watch: values.watch, usage: USAGE };
}

module.exports = { parseCli };
