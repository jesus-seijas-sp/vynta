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

// A global a file defines without saying it is configurable (Strapi's setup file: Object.defineProperty(global,
// 'strapi', { get, set })) could never be removed, and the next file's setup, defining it again, would throw "Cannot
// redefine property". Under Jest every file has a global object of its own; here the properties a file adds to the
// global object are made configurable, so restore() takes them away as it does the others.
function keepGlobalsRemovable() {
  const removable = (target, key, descriptor) =>
    target === globalThis && descriptor && !Reflect.getOwnPropertyDescriptor(globalThis, key)
      ? { ...descriptor, configurable: true }
      : descriptor;
  const { defineProperty, defineProperties } = Object;
  const reflectDefine = Reflect.defineProperty;
  Object.defineProperty = function defineGlobalProperty(target, key, descriptor) {
    return defineProperty(target, key, removable(target, key, descriptor));
  };
  Object.defineProperties = function defineGlobalProperties(target, descriptors) {
    if (target !== globalThis) {
      return defineProperties(target, descriptors);
    }
    Reflect.ownKeys(Object(descriptors)).forEach((key) => {
      defineProperty(target, key, removable(target, key, descriptors[key]));
    });
    return target;
  };
  Reflect.defineProperty = function defineGlobalPropertyReflect(target, key, descriptor) {
    return reflectDefine(target, key, removable(target, key, descriptor));
  };
}

// process.env as it was, to give it back after every file: Jest gives each test file a copy of it, and vitest a
// worker of its own, so a variable one file sets (Strapi's STRAPI_PLUGIN_I18N_INIT_LOCALE_CODE) is not the next one's.
function snapshotEnv() {
  return { ...process.env };
}

function restoreEnv(saved) {
  Object.keys(process.env)
    .filter((name) => !(name in saved))
    .forEach((name) => {
      delete process.env[name];
    });
  Object.entries(saved)
    .filter(([name, value]) => process.env[name] !== value)
    .forEach(([name, value]) => {
      process.env[name] = value;
    });
}

module.exports = { snapshot, restore, keepGlobalsRemovable, snapshotEnv, restoreEnv };
