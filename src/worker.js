const { parentPort, workerData } = require('node:worker_threads');
const v8 = require('node:v8');
const { createRuntime } = require('./runtime');

// A worker thread talks through parentPort, a child process (--pool forks) through process.send.
const channel = parentPort
  ? { send: (message) => parentPort.postMessage(message), on: (fn) => parentPort.on('message', fn) }
  : { send: (message) => process.send(message), on: (fn) => process.on('message', fn) };

const send = (message) => channel.send({ vyntra: true, ...message });

// Runs the files the pool sends, one at a time, and posts back their results. When there are no more, it posts
// what it collected for the whole run (coverage, module resolutions).
function serve(config) {
  createRuntime(config).then(({ run, finish }) => {
    channel.on(async ({ vyntra, type, path, shard }) => {
      if (!vyntra) {
        return;
      }
      if (type === 'run') {
        const result = await run(path, shard);
        // This thread's own heap: a thread can not unload the ES modules it imported, so the pool replaces it past a limit.
        send({ type: 'result', result, heapUsed: v8.getHeapStatistics().used_heap_size });
      } else if (type === 'finish') {
        send({ type: 'finished', collected: await finish() });
      }
    });
    send({ type: 'ready' });
  });
}

if (parentPort) {
  serve(workerData.config);
} else {
  const init = (message) => {
    if (message?.vyntra && message.type === 'init') {
      process.off('message', init);
      serve(message.config);
    }
  };
  process.on('message', init);
}
