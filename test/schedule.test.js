const os = require('node:os');
const path = require('node:path');
const { plan } = require('../src/cli/schedule');
const { ShardMerger } = require('../src/cli/shard-merger');
const fs = require('node:fs');
const { runFixture, copyFixture } = require('./helpers/run-fixture');

const root = path.join(os.tmpdir(), 'project');
const file = (name) => path.join(root, name);

// Timings as the CLI keeps them: { file: { duration, tests, setup } }.
function timingsOf(files) {
  return {
    sort: (list) => [...list].sort((a, b) => (files[b]?.duration ?? 0) - (files[a]?.duration ?? 0)),
    durations: (list) => new Map(list.map((name) => [name, files[name].duration])),
    tests: (name) => files[name]?.tests ?? 0,
    setup: (name) => files[name]?.setup ?? 0,
  };
}

describe('plan', () => {
  const files = {
    [file('long.test.js')]: { duration: 12000, tests: 40, setup: 1000 },
    [file('medium.test.js')]: { duration: 4000, tests: 10, setup: 500 },
    [file('small.test.js')]: { duration: 500, tests: 3, setup: 100 },
  };
  const list = Object.keys(files);

  it('runs every file whole, slowest first, without splitFiles', () => {
    const { jobs } = plan(list, timingsOf(files), { rootDir: root });
    expect(jobs.map((job) => [path.basename(job.path), job.shard])).toEqual([
      ['long.test.js', null],
      ['medium.test.js', null],
      ['small.test.js', null],
    ]);
  });

  it('splits the long files the configuration allows, down to the longest file that can not be split', () => {
    const { jobs, workers } = plan(list, timingsOf(files), { rootDir: root, splitFiles: ['long.test.js'] });
    const parts = jobs.filter((job) => job.path === file('long.test.js'));
    // The medium file (4 s) can not be split: parts of the long one must not take longer.
    expect(parts.length).toBe(4);
    expect(parts.map((job) => job.shard.index).sort()).toEqual([0, 1, 2, 3]);
    expect(Math.max(...parts.map((job) => job.cost))).toBeLessThanOrEqual(4000);
    expect(workers).toBeGreaterThanOrEqual(3);
  });

  it('does not split a file whose parts would mostly repeat its setup', () => {
    const heavySetup = { [file('setup.test.js')]: { duration: 6000, tests: 4, setup: 5000 } };
    const { jobs } = plan(Object.keys(heavySetup), timingsOf(heavySetup), { rootDir: root, splitFiles: true });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].shard).toBeNull();
  });
});

describe('ShardMerger', () => {
  const part = (index, tests) => ({
    path: 'a.test.js',
    shard: { index, count: 2 },
    duration: 1000 + index,
    tests,
    errors: [],
    console: [],
    snapshot: { added: 1, updated: 0, matched: 2, failed: 0, obsolete: 0 },
  });

  it('merges the shards of a file into one result, tests back in their order', () => {
    const merged = [];
    const merger = new ShardMerger((result) => merged.push(result));
    merger.add(part(1, [{ index: 1 }, { index: 3 }]));
    expect(merged).toEqual([]);
    merger.add(part(0, [{ index: 0 }, { index: 2 }]));
    expect(merged).toHaveLength(1);
    expect(merged[0].tests.map((test) => test.index)).toEqual([0, 1, 2, 3]);
    expect(merged[0]).toMatchObject({ duration: 1001, work: 2001, shards: 2, snapshot: { added: 2, matched: 4 } });
  });

  it('passes whole files on, and flushes incomplete ones', () => {
    const merged = [];
    const merger = new ShardMerger((result) => merged.push(result));
    merger.add({ path: 'b.test.js', shard: null, tests: [] });
    merger.add(part(0, [{ index: 0 }]));
    merger.flush();
    expect(merged.map((result) => result.path)).toEqual(['b.test.js', 'a.test.js']);
  });
});

describe('split files', () => {
  it('run in parts on several workers, reported as one file with its tests in order', () => {
    const dir = copyFixture('split');
    const testFile = path.join(dir, 'parts.test.js');
    // What a previous run learned: a long file of 6 tests.
    fs.mkdirSync(path.join(dir, 'node_modules', '.cache', 'vyntra'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'node_modules', '.cache', 'vyntra', 'timings.json'),
      JSON.stringify({ files: { [testFile]: { duration: 30000, tests: 6, setup: 0 } } })
    );
    try {
      const report = runFixture(dir);
      expect(report.files).toHaveLength(1);
      const [result] = report.files;
      expect(result.shards).toBeGreaterThan(1);
      expect(result.tests.map((test) => test.name)).toEqual(
        [0, 1, 2, 3, 4, 5].map((i) => `independent tests test ${i}`)
      );
      expect(result.tests.every((test) => test.status === 'passed')).toBe(true);
      const threads = new Set(result.console.map(({ text }) => text.split(' ').pop()));
      // Workers take the parts as they become free: a quick one may run two.
      expect(threads.size).toBeGreaterThan(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
