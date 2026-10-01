const { parentPort, workerData } = require('node:worker_threads');
const { createRuntime } = require('./runtime');

// A worker thread talks through parentPort, a child process (--pool forks) through process.send.
const channel = parentPort
  ? { send: (message) => parentPort.postMessage(message), on: (fn) => parentPort.on('message', fn) }
  : { send: (message) => process.send(message), on: (fn) => process.on('message', fn) };

const send = (message) => channel.send({ vynta: true, ...message });

// Runs the files the pool sends, one at a time, and posts back their results. When there are no more, it posts
// what it collected for the whole run (coverage, module resolutions).
function serve(config) {
  createRuntime(config).then(({ run, finish }) => {
    channel.on(async ({ vynta, type, path, shard }) => {
      if (!vynta) {
        return;
      }
      if (type === 'run') {
        send({ type: 'result', result: await run(path, shard) });
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
    if (message?.vynta && message.type === 'init') {
      process.off('message', init);
      serve(message.config);
    }
  };
  process.on('message', init);
}
