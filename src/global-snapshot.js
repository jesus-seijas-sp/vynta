// A test file under vitest or Jest starts in a fresh worker, so whatever it leaves on the global
// object (a patched fetch, a never-closed MSW server, a polyfill) dies with it. Here files share a
// thread; restoring the global object between them gives each the start a fresh worker would have.
// Request interceptors also wrap http.request and its kin in a Proxy, in place; a file that never
// closes its MSW server would leave it answering the next file's requests. Only those wrappers are
// undone: Node changes other properties of its builtins lazily, and resetting them breaks it.

const { isProxy } = require('node:util').types;

const PATCHED_BUILTINS = ['http', 'https'];

function same(a, b) {
  return a.value === b.value && a.get === b.get && a.set === b.set;
}

function snapshot() {
  // eslint-disable-next-line global-require -- the builtins are only read to be restored later
  const builtins = PATCHED_BUILTINS.map((name) => require(`node:${name}`));
  return {
    globals: new Map(
      Reflect.ownKeys(globalThis).map((key) => [key, Reflect.getOwnPropertyDescriptor(globalThis, key)])
    ),
    builtins: builtins.map((builtin) => [builtin, new Map(Object.entries(builtin))]),
  };
}

function unwrap(builtin, values) {
  values.forEach((value, key) => {
    if (builtin[key] !== value && isProxy(builtin[key])) {
      builtin[key] = value;
    }
  });
}

function restore({ globals: descriptors, builtins }) {
  builtins.forEach(([builtin, values]) => unwrap(builtin, values));
  Reflect.ownKeys(globalThis)
    .filter((key) => !descriptors.has(key))
    .forEach((key) => Reflect.deleteProperty(globalThis, key));
  descriptors.forEach((descriptor, key) => {
    const now = Reflect.getOwnPropertyDescriptor(globalThis, key);
    if (!now || !same(now, descriptor)) {
      Reflect.defineProperty(globalThis, key, descriptor);
    }
  });
}

module.exports = { snapshot, restore };
