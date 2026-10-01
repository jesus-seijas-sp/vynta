/* eslint-disable no-await-in-loop -- polling: one attempt after the other */
const { realTimers } = require('./timers/real-timers');

const sleep = (ms) =>
  new Promise((resolve) => {
    realTimers.setTimeout(resolve, ms);
  });

const pollOptions = (options) => ({
  timeout: 1000,
  interval: 50,
  ...(typeof options === 'number' ? { timeout: options } : options),
});

// Retries callback until it does not throw, or throws its last error when the timeout ends.
async function waitFor(callback, options = {}) {
  const { timeout, interval } = pollOptions(options);
  const started = Date.now();
  for (;;) {
    try {
      return await callback();
    } catch (error) {
      if (Date.now() - started >= timeout) {
        throw error;
      }
    }
    await sleep(interval);
  }
}

// Retries callback until it returns something truthy.
async function waitUntil(callback, options = {}) {
  const { timeout, interval } = pollOptions(options);
  const started = Date.now();
  for (;;) {
    const result = await callback();
    if (result) {
      return result;
    }
    if (Date.now() - started >= timeout) {
      throw new Error('Timed out in waitUntil!');
    }
    await sleep(interval);
  }
}

module.exports = { waitFor, waitUntil };
