const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { version } = require('../../package.json');
const { colors: c, setColors, detectColors } = require('../colors');
const { mergeCoverage } = require('../coverage/collector');
const { reportCoverage } = require('../coverage/report');
const { ResolveCache, dependencyStamp, cacheFile } = require('../resolve-cache');
const { createRuntime } = require('../runtime');
const { realTimers } = require('../timers');
const { parseCli } = require('./args');
const { loadConfig } = require('./config');
const { discover } = require('./discover');
const { JsonReporter } = require('./json-reporter');
const { Reporter } = require('./reporter');
const { plan } = require('./schedule');
const { ShardMerger } = require('./shard-merger');
const { Timings } = require('./timings');
const { WorkerPool } = require('./worker-pool');

// Everything in the main thread: no worker startup, the fastest option for a handful of small files. Same interface
// as the WorkerPool: run(jobs) resolves with what was collected (coverage), stop() skips the jobs left.
class InlineRunner {
  constructor({ config, onResult }) {
    this.config = config;
    this.onResult = onResult;
    this.stopped = false;
  }

  async run(jobs) {
    const { run, finish } = await createRuntime(this.config);
    await jobs.reduce(
      (prev, job) => prev.then(async () => (this.stopped ? undefined : this.onResult(await run(job.path, job.shard)))),
      Promise.resolve()
    );
    return [await finish()];
  }

  stop() {
    this.stopped = true;
  }
}

// Caches that make loading the dependencies faster, kept in node_modules/.cache (only for projects with node_modules).
function loadingCaches(rootDir) {
  if (!fs.existsSync(path.join(rootDir, 'node_modules'))) {
    return {};
  }
  return {
    resolveCache: { file: cacheFile(rootDir), stamp: dependencyStamp(rootDir) },
    transformCacheDir: path.join(rootDir, 'node_modules', '.cache', 'vyntra', 'compiled'),
  };
}

// Node settles the default locale of Intl as the process starts. A config that sets one (vitest
// configs set LC_ALL so dates format the same on every machine) is only heard by a process started
// after it, so vyntra starts again with it, once. TZ needs nothing: Node reads it whenever it changes.
const LOCALE_VARIABLES = [
  'LC_ALL',
  'LC_TIME',
  'LC_NUMERIC',
  'LC_MONETARY',
  'LC_COLLATE',
  'LC_CTYPE',
  'LC_MESSAGES',
  'LANG',
];
const startLocale = LOCALE_VARIABLES.map((name) => process.env[name]);
const RELAUNCHED = 'VYNTRA_LOCALE_RELAUNCHED';

function localeChanged() {
  return !process.env[RELAUNCHED] && LOCALE_VARIABLES.some((name, i) => process.env[name] !== startLocale[i]);
}

function relaunch(argv) {
  const { status, signal } = spawnSync(process.execPath, [...process.execArgv, process.argv[1], ...argv], {
    stdio: 'inherit',
    env: { ...process.env, [RELAUNCHED]: '1' },
  });
  return signal ? 1 : (status ?? 1);
}

async function main(argv = process.argv.slice(2)) {
  const start = realTimers.performanceNow();
  const cli = parseCli(argv);
  if (cli.help) {
    process.stdout.write(cli.usage);
    return 0;
  }
  if (cli.version) {
    process.stdout.write(`${version}\n`);
    return 0;
  }
  if (cli.watch) {
    process.stderr.write(`${c.yellow('Watch mode is not available yet: running once.')}
`);
  }
  const config = await loadConfig(cli.options);
  if (localeChanged()) {
    return relaunch(argv);
  }
  config.colors ??= detectColors();
  setColors(config.colors);
  const timings = new Timings(config.rootDir);
  const files = timings.sort(discover(config, cli.patterns));
  if (files.length === 0) {
    process.stdout.write(`${c.yellow('No test files found')}\n`);
    return config.passWithNoTests ? 0 : 1;
  }
  // One job (a file run whole) runs in the main thread: no worker to start. A single long file split in parts does
  // get workers. In the main thread, split files would only run one part after the other: they run whole.
  const planned = config.pool === 'inline' ? null : plan(files, timings, config);
  const inline = !planned || planned.jobs.length === 1;
  const { jobs, workers } = inline ? { jobs: files.map((file) => ({ path: file, shard: null })), workers: 1 } : planned;
  const ReporterClass = config.reporter === 'json' ? JsonReporter : Reporter;
  const reporter = new ReporterClass({ ...config, pool: inline ? 'inline' : config.pool });
  reporter.onStart(files.length, workers);
  let failedFiles = 0;
  let runner;
  const onFileResult = (result) => {
    const work = result.work ?? result.duration;
    const testTime = result.tests.reduce((sum, test) => sum + test.duration, 0);
    timings.record(result.path, work, result.tests.length, Math.max(0, work - testTime) / (result.shards ?? 1));
    reporter.onFileResult(result);
    if (result.errors.length > 0 || result.tests.some((test) => test.status === 'failed')) {
      failedFiles += 1;
      // --bail n: no more files once n have failed.
      if (config.bail > 0 && failedFiles >= config.bail) {
        runner.stop();
      }
    }
  };
  const merger = new ShardMerger(onFileResult);
  const onResult = (result) => merger.add(result);
  // Coverage leaves out the test files themselves.
  config.testFiles = files;
  Object.assign(config, loadingCaches(config.rootDir));
  // V8 keys its code cache by module URL, and each test file imports the project's modules under URLs of
  // its own: the cache grows by a copy per file and run and is rarely read back. Measured slower than
  // compiling, so it is only kept for configs that ask (compileCache: true).
  if (config.compileCache === true) {
    config.compileCacheDir = path.join(config.rootDir, 'node_modules', '.cache', 'vyntra', 'v8');
  }
  if (inline) {
    runner = new InlineRunner({ config, onResult });
  } else {
    // The config crosses to the workers by structured clone: no functions.
    // Plugins hold functions too: each worker loads them from the config file.
    const workerConfig = Object.fromEntries(
      Object.entries(config).filter(([key, value]) => typeof value !== 'function' && key !== 'plugins')
    );
    runner = new WorkerPool({ size: workers, config: workerConfig, onResult });
  }
  const collected = await runner.run(jobs);
  merger.flush();
  timings.save();
  if (config.resolveCache) {
    ResolveCache.save(
      config.resolveCache,
      collected.map((item) => item.resolutions)
    );
  }
  const passed = reporter.onFinish(realTimers.performanceNow() - start);
  const coverage = collected.map((item) => item.coverage).filter(Boolean);
  const covered = config.coverage ? reportCoverage(mergeCoverage(coverage), config) : true;
  return passed && covered && failedFiles === 0 ? 0 : 1;
}

module.exports = { main };
