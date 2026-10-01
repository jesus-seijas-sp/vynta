const path = require('node:path');
const Module = require('node:module');

// Tests of a browser component need a document. vynta does not ship one: it builds the window from
// the happy-dom or jsdom the project already has, once per worker, and copies its globals onto this
// thread. A project that asks for no environment loads neither, which is why `environment: 'node'`
// stays as fast as it was.

// Node owns these on purpose: its timers are the ones the fake timers replace, and a document's
// copies would leave vi.useFakeTimers() controlling something nothing calls.
const KEEP_NODE = new Set([
  'global',
  'globalThis',
  'process',
  'Buffer',
  'console',
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
  'setImmediate',
  'clearImmediate',
  'queueMicrotask',
  'structuredClone',
  'require',
  'module',
  'exports',
  '__dirname',
  '__filename',
  'undefined',
  'NaN',
  'Infinity',
  'eval',
  // Redefining this one aborts the process from a worker thread: Node reaches for the context's
  // own exports to build its replacement and finds no isolate data. Node's own is compatible.
  'DOMException',
]);

// The language's own globals, which a window also carries. Copying them replaces the ones every
// loaded module already closed over, so an `instanceof` or an `Object.keys` crosses realms and a
// dependency fails far from here — faker builds its locales with Object and stops working at all.
// A document contributes the web platform; the language stays Node's.
const INTRINSICS = new Set([
  'Object',
  'Function',
  'Boolean',
  'Symbol',
  'Error',
  'AggregateError',
  'EvalError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'TypeError',
  'URIError',
  'Number',
  'BigInt',
  'Math',
  'Date',
  'String',
  'RegExp',
  'Array',
  'Int8Array',
  'Uint8Array',
  'Uint8ClampedArray',
  'Int16Array',
  'Uint16Array',
  'Int32Array',
  'Uint32Array',
  'Float32Array',
  'Float64Array',
  'BigInt64Array',
  'BigUint64Array',
  'Map',
  'Set',
  'WeakMap',
  'WeakSet',
  'WeakRef',
  'FinalizationRegistry',
  'ArrayBuffer',
  'SharedArrayBuffer',
  'DataView',
  'Atomics',
  'JSON',
  'Promise',
  'Reflect',
  'Proxy',
  'Intl',
  'parseInt',
  'parseFloat',
  'isNaN',
  'isFinite',
  'decodeURI',
  'decodeURIComponent',
  'encodeURI',
  'encodeURIComponent',
  'escape',
  'unescape',
]);

let current = null;

function load(name, rootDir) {
  const require = Module.createRequire(path.join(rootDir, 'package.json'));
  try {
    return require(name);
  } catch (error) {
    throw new Error(
      `Can not use the "${name}" environment: it is not installed in ${rootDir}. Add it, or set environment to "node".`
    );
  }
}

// Node already has these, but they must come from the document: a request built with the window's
// Request read by Node's fetch (or the reverse) loses its body, and an event from one realm is not an
// Event to the other. Every other global Node already owns stays Node's.
const FROM_WINDOW = new Set([
  'Event',
  'EventTarget',
  'CustomEvent',
  'MessageEvent',
  'MessagePort',
  'Crypto',
  'Performance',
  'Navigator',
  'navigator',
  'Blob',
  'File',
  'FormData',
  'WebSocket',
  'fetch',
  'Request',
  'Response',
  'Headers',
  'AbortController',
  'AbortSignal',
  'URL',
  'URLSearchParams',
]);

const SELF_REFERENCES = ['window', 'self', 'top', 'parent'];

function createWindow(name, rootDir, url) {
  if (name === 'happy-dom') {
    // GlobalWindow shares this thread's intrinsics instead of creating its own.
    const { Window, GlobalWindow } = load('happy-dom', rootDir);
    return new (GlobalWindow || Window)({
      url,
      console: globalThis.console,
      settings: { disableErrorCapturing: true },
    });
  }
  const { JSDOM } = load('jsdom', rootDir);
  return new JSDOM('<!doctype html><html><head></head><body></body></html>', { url, pretendToBeVisual: true }).window;
}

function shouldCopy(key) {
  if (KEEP_NODE.has(key) || INTRINSICS.has(key) || SELF_REFERENCES.includes(key)) {
    return false;
  }
  return !(key in globalThis) || FROM_WINDOW.has(key);
}

// Each global reads through to the window, so a property the window computes from its own state
// (document, location, innerWidth) stays live. A test that assigns one replaces it for everyone.
// Methods are bound because the window's own expect `this` to be the window, not this thread's global.
function populate(window) {
  const originals = new Map();
  const keys = new Set([...Object.getOwnPropertyNames(window), ...FROM_WINDOW].filter(shouldCopy));
  keys.forEach((key) => {
    const value = window[key];
    const bound = typeof value === 'function' && key[0] !== key[0].toUpperCase() ? value.bind(window) : null;
    const original = Reflect.getOwnPropertyDescriptor(globalThis, key);
    if (original) {
      originals.set(key, original);
    }
    let override;
    let overridden = false;
    try {
      Reflect.defineProperty(globalThis, key, {
        get: () => (overridden ? override : (bound ?? window[key])),
        set: (next) => {
          overridden = true;
          override = next;
        },
        configurable: true,
        enumerable: true,
      });
    } catch {
      // A global Node refuses to redefine stays as it is.
    }
  });
  // In a browser the window is the global object, so `window.X = ...` and a bare `X` are one thing.
  SELF_REFERENCES.forEach((key) => {
    originals.set(key, Reflect.getOwnPropertyDescriptor(globalThis, key));
    Reflect.defineProperty(globalThis, key, { value: globalThis, writable: true, configurable: true });
  });
  if (window.document) {
    Reflect.defineProperty(window.document, 'defaultView', { get: () => globalThis, configurable: true });
  }
  return { keys, originals };
}

let created = null;

function install(config = {}) {
  const name = config.environment ?? 'node';
  if (name === 'node' || current) {
    return current;
  }
  const url = config.environmentUrl ?? 'http://localhost:3000/';
  created ??= { name, url, window: createWindow(name, config.rootDir ?? process.cwd(), url) };
  current = { ...created, ...populate(created.window) };
  return current;
}

function clearCookies(document) {
  document.cookie
    .split(';')
    .map((cookie) => cookie.split('=')[0].trim())
    .filter(Boolean)
    .forEach((name) => {
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    });
}

// The window outlives a test file: libraries loaded once per thread (Testing Library's `screen`)
// hold its document. What a file put in it goes, so the next one starts as a new page would.
function clearPage(window, url) {
  const { document } = window;
  clearCookies(document);
  window.localStorage?.clear();
  window.sessionStorage?.clear();
  document.head.replaceChildren();
  document.body.replaceChildren();
  [document.body, document.documentElement].forEach((element) => {
    [...element.attributes].forEach(({ name }) => element.removeAttribute(name));
  });
  if (window.location.href !== url) {
    window.history.replaceState(null, '', url);
  }
}

// Gives the global object back as it was before install; the window stays for the next file.
function teardown() {
  if (!current) {
    return;
  }
  const { window, url, keys, originals } = current;
  current = null;
  [...keys, ...SELF_REFERENCES].forEach((key) => {
    const original = originals.get(key);
    if (original) {
      Reflect.defineProperty(globalThis, key, original);
    } else {
      Reflect.deleteProperty(globalThis, key);
    }
  });
  clearPage(window, url);
}

module.exports = { install, teardown };
