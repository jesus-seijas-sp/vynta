const fs = require('node:fs');
const { jsdomBridges } = require('./jsdom-bridges');
const { trackListeners, releaseListeners } = require('./listeners');
const { callingPackage } = require('./collect/api');
const path = require('node:path');
const Module = require('node:module');

// Tests of a browser component need a document. vyntra does not ship one: it builds the window from
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

// Node already has these, but they must come from the document: an event from one realm is not an
// Event to the other. Every other global Node already owns stays Node's, as in vitest.
const DOM_GLOBALS = [
  'Event',
  'EventTarget',
  'CustomEvent',
  'MessageEvent',
  'Crypto',
  'Performance',
  'Navigator',
  'navigator',
  'Blob',
  'File',
  'FormData',
  'WebSocket',
];

// happy-dom brings its own fetch, and its Request read by Node's fetch (or the reverse) loses the body,
// so the whole family comes from it. jsdom has no fetch: Node's stays, and so must the AbortSignal and
// URL it accepts.
const FROM_WINDOW = {
  'happy-dom': new Set([
    ...DOM_GLOBALS,
    'MessagePort',
    'fetch',
    'Request',
    'Response',
    'Headers',
    'AbortController',
    'AbortSignal',
    'URL',
    'URLSearchParams',
  ]),
  jsdom: new Set(DOM_GLOBALS),
};

const SELF_REFERENCES = ['window', 'self', 'top', 'parent'];

// jsdom moves a window to another origin only through the JSDOM that made it.
const jsdoms = new WeakMap();
const bridges = new WeakMap();

// environmentOptions takes vitest's shape: { happyDOM: {...}, jsdom: {...} }, passed to the constructors.
function createWindow(name, rootDir, url, options = {}) {
  if (name === 'happy-dom') {
    // GlobalWindow shares this thread's intrinsics instead of creating its own.
    const { Window, GlobalWindow } = load('happy-dom', rootDir);
    const happyDOM = options.happyDOM ?? {};
    return new (GlobalWindow || Window)({
      ...happyDOM,
      url: happyDOM.url ?? url,
      console: globalThis.console,
      settings: { ...happyDOM.settings, disableErrorCapturing: true },
    });
  }
  const { JSDOM } = load('jsdom', rootDir);
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    pretendToBeVisual: true,
    ...options.jsdom,
    url: options.jsdom?.url ?? url,
  });
  jsdoms.set(dom.window, dom);
  bridges.set(dom.window, jsdomBridges(dom.window));
  return dom.window;
}

function shouldCopy(key, fromWindow) {
  if (KEEP_NODE.has(key) || INTRINSICS.has(key) || SELF_REFERENCES.includes(key)) {
    return false;
  }
  return !(key in globalThis) || fromWindow.has(key);
}

// The window's own properties and its prototypes' (jsdom keeps addEventListener and the like on
// Window.prototype and EventTarget.prototype), short of what every object has.
function windowKeys(window) {
  const keys = new Set();
  for (let target = window; target && target !== Object.prototype; target = Object.getPrototypeOf(target)) {
    Object.getOwnPropertyNames(target)
      .filter((key) => key !== 'constructor')
      .forEach((key) => keys.add(key));
  }
  return keys;
}

// Each global reads through to the window, so a property the window computes from its own state
// (document, location, innerWidth) stays live. A test that assigns one replaces it for everyone.
// Methods are bound because the window's own expect `this` to be the window, not this thread's global.
function populate(window, name) {
  const originals = new Map();
  const fromWindow = FROM_WINDOW[name] ?? FROM_WINDOW['happy-dom'];
  // A window without one of them leaves Node's in place.
  const provided = [...fromWindow].filter((key) => window[key] !== undefined);
  const keys = new Set([...windowKeys(window), ...provided].filter((key) => shouldCopy(key, fromWindow)));
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

function ownDescriptors(target) {
  return new Map(Reflect.ownKeys(target).map((key) => [key, Reflect.getOwnPropertyDescriptor(target, key)]));
}

// What a file defined on the navigator (a clipboard, a getUserMedia double) goes with it.
function restoreOwn(target, descriptors) {
  Reflect.ownKeys(target)
    .filter((key) => !descriptors.has(key))
    .forEach((key) => Reflect.deleteProperty(target, key));
  descriptors.forEach((descriptor, key) => Reflect.defineProperty(target, key, descriptor));
}

// Only what changed is put back: there are hundreds of prototypes and few ever change.
function restoreChanged(target, descriptors) {
  Reflect.ownKeys(target)
    .filter((key) => !descriptors.has(key))
    .forEach((key) => Reflect.deleteProperty(target, key));
  descriptors.forEach((descriptor, key) => {
    const now = Reflect.getOwnPropertyDescriptor(target, key);
    if (!now || now.value !== descriptor.value || now.get !== descriptor.get || now.set !== descriptor.set) {
      Reflect.defineProperty(target, key, descriptor);
    }
  });
}

// The prototypes of a window's interfaces (Element, Range, Document...), as the window was made. A file
// that patches one (a stub of getClientRects for an editor) would otherwise leave it patched for every
// file after it, where a fresh window would not.
function prototypesOf(window) {
  const prototypes = new Set();
  windowKeys(window).forEach((key) => {
    let value;
    try {
      value = window[key];
    } catch {
      return;
    }
    if (typeof value === 'function' && value.prototype && typeof value.prototype === 'object') {
      prototypes.add(value.prototype);
    }
  });
  return [...prototypes].map((prototype) => [prototype, ownDescriptors(prototype)]);
}

const insertedByDependency = new WeakSet();

// Marks what package code inserts into the head, which outlives the file (see clearPage).
function trackHead(head) {
  ['appendChild', 'insertBefore', 'append', 'prepend'].forEach((method) => {
    const original = head[method];
    Object.defineProperty(head, method, {
      configurable: true,
      writable: true,
      value: function trackedInsert(...args) {
        if (callingPackage()) {
          const nodes = method === 'append' || method === 'prepend' ? args : [args[0]];
          nodes.filter((node) => typeof node === 'object' && node).forEach((node) => insertedByDependency.add(node));
        }
        return original.apply(this, args);
      },
    });
  });
}

// One window per environment and thread, made the first time a file asks for it.
const created = new Map();

function install(config = {}) {
  const name = config.environment ?? 'node';
  if (name === 'node' || current) {
    return current;
  }
  const url = config.environmentUrl ?? 'http://localhost:3000/';
  if (!created.has(name)) {
    const window = createWindow(name, config.rootDir ?? process.cwd(), url, config.environmentOptions);
    // Before the prototypes are taken, so the restore between files keeps the tracking in place.
    trackListeners(window);
    if (window.document?.head) {
      trackHead(window.document.head);
    }
    created.set(name, {
      name,
      url,
      window,
      navigator: ownDescriptors(window.navigator),
      // The elements the page started with, which libraries loaded once per thread hold on to.
      page: { html: window.document.documentElement, head: window.document.head, body: window.document.body },
      prototypes: prototypesOf(window),
    });
  }
  const { window } = created.get(name);
  const populated = populate(window, name);
  Object.entries(bridges.get(window) ?? {}).forEach(([key, value]) => {
    if (!populated.originals.has(key)) {
      populated.originals.set(key, Reflect.getOwnPropertyDescriptor(globalThis, key));
    }
    populated.keys.add(key);
    Reflect.defineProperty(globalThis, key, { value, writable: true, configurable: true });
  });
  current = { ...created.get(name), ...populated };
  return current;
}

const DOCBLOCK_ENVIRONMENT = /@(?:vitest|jest)-environment\s+([\w-]+)/;

// The environment a file asks for in its leading comment (`@vitest-environment jsdom`, or Jest's), if any.
function environmentOf(file) {
  let head;
  try {
    head = fs.readFileSync(file, 'utf8').slice(0, 2048);
  } catch {
    return null;
  }
  const comment = /^\s*(?:\/\*[\s\S]*?\*\/|(?:\/\/[^\n]*\n\s*)+)/.exec(head)?.[0] ?? '';
  const name = DOCBLOCK_ENVIRONMENT.exec(comment)?.[1];
  return name ? name.replace(/^jest-environment-/, '') : null;
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
// A test may swap the document's elements (a full-page navigation replaces the <body>), and a library
// loaded once per thread keeps the ones it saw first: Testing Library's screen searches the first
// <body>. The page gets its own elements back before it is cleared, as a fresh document would have them.
function restoreElements(document, page) {
  if (!page) {
    return;
  }
  if (document.documentElement !== page.html) {
    document.replaceChild(page.html, document.documentElement);
  }
  if (document.head !== page.head) {
    if (document.head) {
      document.head.replaceWith(page.head);
    } else {
      page.html.prepend(page.head);
    }
  }
  if (document.body !== page.body) {
    document.body = page.body;
  }
}

function clearPage(window, url, navigator, page) {
  const { document } = window;
  restoreElements(document, page);
  if (navigator) {
    restoreOwn(window.navigator, navigator);
  }
  clearCookies(document);
  window.localStorage?.clear();
  window.sessionStorage?.clear();
  // What a library put in the head stays: one loaded once per thread (aphrodite) keeps writing into the
  // <style> it made, and with it gone its sheet is null. What the file put there (a test's own <style>)
  // goes, as it would with a fresh document.
  [...document.head.childNodes].filter((node) => !insertedByDependency.has(node)).forEach((node) => node.remove());
  document.body.replaceChildren();
  [document.body, document.documentElement].forEach((element) => {
    [...element.attributes].forEach(({ name }) => element.removeAttribute(name));
  });
  if (window.location.href === url) {
    return;
  }
  // history can only move within the origin; a test that navigated elsewhere needs the engine's own way back.
  if (new URL(window.location.href).origin === new URL(url).origin) {
    window.history.replaceState(null, '', url);
  } else if (window.happyDOM?.setURL) {
    window.happyDOM.setURL(url);
  } else {
    jsdoms.get(window)?.reconfigure({ url });
  }
}

// Gives the global object back as it was before install; the window stays for the next file.
function teardown() {
  if (!current) {
    return;
  }
  const { window, url, keys, originals, navigator, prototypes, page } = current;
  releaseListeners();
  current = null;
  [...keys, ...SELF_REFERENCES].forEach((key) => {
    const original = originals.get(key);
    if (original) {
      Reflect.defineProperty(globalThis, key, original);
    } else {
      Reflect.deleteProperty(globalThis, key);
    }
  });
  clearPage(window, url, navigator, page);
  prototypes.forEach(([prototype, descriptors]) => restoreChanged(prototype, descriptors));
}

// Stops what the file left running in the document (a fetch still in flight, a timer of the window's),
// as closing its window does under vitest: otherwise it lands in the next file, mid-test.
async function settle() {
  await current?.window.happyDOM?.abort?.();
}

module.exports = { install, teardown, settle, environmentOf };
