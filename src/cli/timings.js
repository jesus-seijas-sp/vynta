const fs = require('node:fs');
const path = require('node:path');

// What the last run learned about every file: how long it took and how many tests it has. The slowest files start
// first (the run then ends when the slowest file does, instead of a slow file starting last and running alone), and
// long files can be split in as many parts as they have tests.
class Timings {
  constructor(rootDir) {
    this.file = path.join(rootDir, 'node_modules', '.cache', 'vyntra', 'timings.json');
    this.files = {};
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      // Older files kept only the durations.
      Object.entries(saved.files ?? saved).forEach(([file, value]) => {
        this.files[file] = typeof value === 'number' ? { duration: value, tests: 0, setup: 0 } : value;
      });
    } catch {
      // First run.
    }
  }

  duration(file) {
    return this.files[file]?.duration;
  }

  tests(file) {
    return this.files[file]?.tests ?? 0;
  }

  // Time a run of the file spends out of its tests (loading it, beforeAll and afterAll): what every part of a split
  // file repeats.
  setup(file) {
    return this.files[file]?.setup ?? 0;
  }

  // Durations of the files, the ones never run guessed as the average of the others; null when most never ran.
  durations(files) {
    const known = files.map((file) => this.duration(file)).filter((duration) => duration !== undefined);
    if (known.length < files.length / 2) {
      return null;
    }
    const guess = known.reduce((sum, duration) => sum + duration, 0) / known.length;
    return new Map(files.map((file) => [file, this.duration(file) ?? guess]));
  }

  // Slowest first; files never run come first, ordered by size as a guess of their duration.
  sort(files) {
    const cost = (file) => this.duration(file) ?? Infinity;
    const size = (file) => fs.statSync(file).size;
    return [...files].sort((a, b) => cost(b) - cost(a) || size(b) - size(a));
  }

  // duration: the file run whole (or its parts added up); setup: the time out of tests of one run (or part).
  record(file, duration, tests, setup) {
    this.files[file] = { duration: Math.round(duration), tests, setup: Math.round(setup) };
  }

  save() {
    // A project without node_modules gets none created just for this.
    if (!fs.existsSync(path.dirname(path.dirname(path.dirname(this.file))))) {
      return;
    }
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify({ files: this.files }));
    } catch {
      // A read-only project: nothing to keep.
    }
  }
}

module.exports = { Timings };
