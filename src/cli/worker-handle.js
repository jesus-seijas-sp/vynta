const path = require('node:path');
const { fork } = require('node:child_process');
const { Worker } = require('node:worker_threads');

const WORKER_FILE = path.join(__dirname, '..', 'worker.js');

// The same interface over a worker thread or a child process: send(message), on(event, fn) for 'message', 'error'
// and 'exit', terminate(). Messages of vyntra carry `vyntra: true`; others (from the code under test) are ignored.
function createThread(config) {
  const worker = new Worker(WORKER_FILE, { workerData: { config }, execArgv: process.execArgv });
  return {
    send: (message) => worker.postMessage({ vyntra: true, ...message }),
    on: (event, fn) => worker.on(event, fn),
    terminate: () => worker.terminate(),
  };
}

// A child process, like Jest's workers: for code that needs a process of its own (process.chdir, process.send,
// native addons that are not thread safe).
function createFork(config) {
  const child = fork(WORKER_FILE, [], { serialization: 'advanced', execArgv: process.execArgv });
  child.send({ vyntra: true, type: 'init', config });
  return {
    send: (message) => child.send({ vyntra: true, ...message }),
    on: (event, fn) => child.on(event, fn),
    terminate: () => child.kill(),
  };
}

const createWorker = (pool, config) => (pool === 'forks' ? createFork(config) : createThread(config));

module.exports = { createWorker };
