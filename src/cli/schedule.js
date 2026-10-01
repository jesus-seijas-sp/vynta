const os = require('node:os');
const path = require('node:path');
const { globToRegExp } = require('./glob');

// Parts of a split file shorter than this are not worth what each part repeats (loading the file, its beforeAll).
const MIN_PART_MS = 3000;
// A file is split only when that makes it this much shorter: splitting adds work, so it must buy time.
const MIN_GAIN = 1.25;

const toPosix = (file) => file.split(path.sep).join('/');

// Which files may be split: splitFiles is true (all of them) or a list of globs, relative to the root.
function splittable(config) {
  if (config.splitFiles === true) {
    return () => true;
  }
  if (!Array.isArray(config.splitFiles) || config.splitFiles.length === 0) {
    return () => false;
  }
  const globs = config.splitFiles.map(globToRegExp);
  return (file) => {
    const relative = toPosix(path.relative(config.rootDir, file));
    return globs.some((glob) => glob.test(relative));
  };
}

function explicitWorkers(maxWorkers, cores) {
  if (typeof maxWorkers === 'string' && maxWorkers.endsWith('%')) {
    return Math.floor((cores * parseFloat(maxWorkers)) / 100);
  }
  return Number(maxWorkers);
}

// A file as the scheduler sees it. A part of a split file costs the setup it repeats plus its share of the tests;
// floor is the shortest the file can get (one test per part).
function describeFile(file, cost, timings, canSplit) {
  const tests = timings.tests(file);
  const setup = Math.min(timings.setup(file), cost);
  const split = canSplit(file) && tests >= 2;
  const perTest = (cost - setup) / Math.max(1, tests);
  return { file, cost, tests, setup, split, floor: split ? setup + perTest : cost };
}

// The parts a file is run in so that none takes much longer than target: [{ path, shard, cost }].
function jobsOf(info, target) {
  const whole = [{ path: info.file, shard: null, cost: info.cost }];
  if (!info.split || info.cost < target * MIN_GAIN || target <= info.setup) {
    return whole;
  }
  const count = Math.min(info.tests, Math.ceil((info.cost - info.setup) / (target - info.setup)));
  const partCost = info.setup + (info.cost - info.setup) / count;
  if (count < 2 || info.cost < partCost * MIN_GAIN) {
    return whole;
  }
  return Array.from({ length: count }, (_, index) => ({ path: info.file, shard: { index, count }, cost: partCost }));
}

// What to run, and on how many workers. Without durations from a previous run: every file whole, on half the
// cores. With them: just enough workers for the longest job to be the whole run, as more only add startup and
// contention for the cores. Files the configuration allows to split are cut when they are the long ones: down to
// the longest file that can not get shorter, and never below what their setup makes worth it.
function plan(files, timings, config) {
  const cores = os.availableParallelism();
  const sorted = timings.sort(files);
  const durations = timings.durations(sorted);
  if (!durations) {
    const workers = config.maxWorkers !== undefined ? explicitWorkers(config.maxWorkers, cores) : Math.floor(cores / 2);
    return {
      jobs: sorted.map((file) => ({ path: file, shard: null, cost: 0 })),
      workers: Math.max(1, Math.min(workers, files.length)),
    };
  }
  const canSplit = splittable(config);
  const infos = sorted.map((file) => describeFile(file, durations.get(file), timings, canSplit));
  const total = infos.reduce((sum, info) => sum + info.cost, 0);
  // Test files often start servers of their own: when splitting, at most half the cores, which they leave free.
  const splitting = infos.some((info) => info.split);
  const cap = splitting ? Math.max(2, Math.floor(cores / 2)) : cores - 1;
  const target = Math.max(MIN_PART_MS, ...infos.map((info) => info.floor), total / cap);
  const jobs = infos.flatMap((info) => jobsOf(info, target)).sort((a, b) => b.cost - a.cost);
  const work = jobs.reduce((sum, job) => sum + job.cost, 0);
  const longest = Math.max(1, ...jobs.map((job) => job.cost));
  const workers =
    config.maxWorkers !== undefined
      ? explicitWorkers(config.maxWorkers, cores)
      : Math.min(cap, Math.ceil(work / longest));
  return { jobs, workers: Math.max(1, Math.min(workers, jobs.length)) };
}

module.exports = { plan };
