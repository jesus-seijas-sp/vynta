const { realTimers } = require('../timers');
const { format } = require('../expect/format');

// A first parameter that is destructured, or named like a context, receives the vitest test context; any other
// parameter of a non-async function is a Jest done callback.
const CONTEXT_PARAM =
  /^(?:async\s*)?(?:function\b[^(]*)?\(\s*[{[]|^(?:async\s*)?\(?\s*(?:_?ctx|_?context|task)\s*[,)=]/;

const doneCache = new WeakMap();

function wantsDone(fn) {
  if (fn.length === 0) {
    return false;
  }
  if (!doneCache.has(fn)) {
    const source = Function.prototype.toString.call(fn);
    doneCache.set(fn, !/^async\b/.test(source) && !CONTEXT_PARAM.test(source));
  }
  return doneCache.get(fn);
}

function timeoutError(ms, kind) {
  const what = kind === 'hook' ? 'Hook' : 'Test';
  return new Error(
    `${what} timed out in ${ms}ms.\nIf this is a long-running ${what.toLowerCase()}, pass a timeout value as the last argument or configure it globally with "testTimeout".`
  );
}

function withTimeout(promise, ms, kind) {
  if (!ms || ms <= 0 || ms === Infinity) {
    return promise;
  }
  const { promise: timeout, reject } = Promise.withResolvers();
  const timer = realTimers.setTimeout(() => reject(timeoutError(ms, kind)), ms);
  return Promise.race([promise, timeout]).finally(() => realTimers.clearTimeout(timer));
}

function invokeWithDone(fn, context) {
  const { promise, resolve, reject } = Promise.withResolvers();
  let finished = false;
  const done = (error) => {
    if (finished) {
      return;
    }
    finished = true;
    if (!error) {
      resolve();
    } else {
      reject(error instanceof Error ? error : new Error(`Failed: ${format(error, { min: true })}`));
    }
  };
  done.fail = (message = 'Failed') => done(new Error(message));
  Object.assign(done, context);
  const result = fn(done);
  if (typeof result?.then === 'function') {
    reject(
      new Error(
        "Test functions cannot both take a 'done' callback and return something. Either use a 'done' callback, or return a promise."
      )
    );
  }
  return promise;
}

// Calls a test or hook function. Returns what it returned when it ended synchronously (a beforeEach may return its
// cleanup), or a promise that settles when it ends or times out.
function invoke(fn, context, ms, kind) {
  if (wantsDone(fn)) {
    return withTimeout(invokeWithDone(fn, context), ms, kind);
  }
  const result = fn(context);
  return typeof result?.then === 'function' ? withTimeout(result, ms, kind) : result;
}

module.exports = { invoke, wantsDone };
