// A test file under vitest or Jest starts in a fresh worker, so whatever it leaves on the global
// object (a patched fetch, a never-closed MSW server, a polyfill) dies with it. Here files share a
// thread; restoring the global object between them gives each the start a fresh worker would have.

function same(a, b) {
  return a.value === b.value && a.get === b.get && a.set === b.set;
}

function snapshot() {
  return new Map(Reflect.ownKeys(globalThis).map((key) => [key, Reflect.getOwnPropertyDescriptor(globalThis, key)]));
}

function restore(descriptors) {
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
