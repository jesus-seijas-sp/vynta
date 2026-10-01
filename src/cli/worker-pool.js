const { serializeError } = require('../run/serialize-error');
const { createWorker } = require('./worker-handle');
const { environmentOf } = require('../environment');

// The result of a job whose worker died while running it.
const failed = (result) => result.errors.length > 0 || result.tests.some((test) => test.status === 'failed');

const crashResult = (job, error) => ({
  path: job.path,
  shard: job.shard,
  duration: 0,
  tests: [],
  errors: [serializeError(error)],
  console: [],
});

// Runs test files on worker threads (or child processes, with pool: 'forks'). Files are handed out one at a time as workers become free, so a slow file
// never holds others back behind it; each worker keeps its module cache warm between files. A worker whose file
// failed is replaced: a failure can leave a dependency's module state broken (React stuck mid-render), and every
// later file on that worker would fail with it. A worker also keeps to one document environment: a library loaded
// under happy-dom holds on to that document (Testing Library's screen), and a jsdom file after it would query the
// wrong one. Files that need no document run on any worker.
class WorkerPool {
  constructor({ size, config, onResult }) {
    this.size = size;
    this.config = config;
    this.onResult = onResult;
    this.queue = [];
    this.workers = new Set();
    // What each worker collected over the run (coverage, module resolutions), when it finishes.
    this.collected = [];
  }

  // Runs the jobs ({ path, shard }); resolves with what the workers collected.
  run(jobs) {
    const fallback = this.config.environment ?? 'node';
    this.queue = jobs.map((job) => ({ ...job, environment: environmentOf(job.path) ?? fallback }));
    const { promise, resolve } = Promise.withResolvers();
    this.done = () => resolve(this.collected);
    const count = Math.min(this.size, this.queue.length);
    if (count === 0) {
      this.done();
    }
    for (let i = 0; i < count; i += 1) {
      this.spawn();
    }
    return promise;
  }

  spawn() {
    const worker = createWorker(this.config.pool, this.config);
    this.workers.add(worker);
    let current = null;
    let replacing = false;
    let environment = null;
    const next = () => {
      const index = this.queue.findIndex(
        (job) => job.environment === 'node' || environment === null || job.environment === environment
      );
      if (index === -1) {
        // What is left needs another document: a fresh worker takes it.
        replacing = this.queue.length > 0;
        worker.send({ type: 'finish' });
        return;
      }
      [current] = this.queue.splice(index, 1);
      if (current.environment !== 'node') {
        environment = current.environment;
      }
      worker.send({ type: 'run', path: current.path, shard: current.shard });
    };
    worker.on('message', (message) => {
      // Messages the code under test sends (process.send in a child process) are not for the pool.
      if (!message?.vyntra) {
        return;
      }
      if (message.type === 'finished') {
        if (replacing && this.queue.length > 0) {
          this.spawn();
        }
        this.retire(worker, message.collected);
        return;
      }
      if (message.type === 'result') {
        current = null;
        this.onResult(message.result);
        if (this.queue.length > 0 && this.shouldReplace(message)) {
          replacing = true;
          worker.send({ type: 'finish' });
          return;
        }
      }
      next();
    });
    const crash = (error) => {
      if (!this.workers.has(worker)) {
        return;
      }
      this.workers.delete(worker);
      if (current) {
        this.onResult(crashResult(current, error));
        current = null;
      }
      if (this.queue.length > 0) {
        this.spawn();
      } else {
        this.finishIfIdle();
      }
    };
    worker.on('error', crash);
    worker.on('exit', (code) => crash(new Error(`The worker running this file exited with code ${code}`)));
  }

  // A worker is replaced after a failing file, or once its heap passes workerMemoryLimit (megabytes): it keeps
  // every ES module it imported, one copy of the project's modules per test file.
  shouldReplace({ result, heapUsed }) {
    const { replaceFailedWorkers, workerMemoryLimit } = this.config;
    return (
      (replaceFailedWorkers !== false && failed(result)) ||
      (workerMemoryLimit > 0 && heapUsed > workerMemoryLimit * 1024 * 1024)
    );
  }

  // Skips the files not started yet.
  stop() {
    this.queue = [];
  }

  retire(worker, collected) {
    this.workers.delete(worker);
    if (collected) {
      this.collected.push(collected);
    }
    worker.terminate();
    this.finishIfIdle();
  }

  finishIfIdle() {
    if (this.workers.size === 0) {
      this.done();
    }
  }
}

module.exports = { WorkerPool };
