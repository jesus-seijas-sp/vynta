const { callingPackage } = require('./collect/api');

// A document outlives the test file here, and so would every listener a file added to its long-lived
// objects (the window, the document, <html>, <head>, <body>): Turbo listens for clicks on the document
// once it starts, and every later file's link clicks became Turbo visits. Under vitest the document
// goes with its file. Listeners added to those objects are taken off when the file ends; one a library
// added (by the package's own code) comes back for each later file that imports that package, as a fresh
// load of it would add it again.

const capture = (options) => (typeof options === 'boolean' ? options : Boolean(options?.capture));

const tracked = new WeakSet();
let added = [];
const dependencyListeners = [];

function trackListeners(window) {
  if (tracked.has(window)) {
    return;
  }
  tracked.add(window);
  const { document } = window;
  const same = (entry, target, type, listener, options) =>
    entry.target === target && entry.type === type && entry.listener === listener && entry.capture === capture(options);
  // On the objects themselves: a DOM implementation may give the window, the document and the elements
  // prototypes of their own, and only these objects live on.
  [window, document, document?.documentElement, document?.head, document?.body]
    .filter((target) => target && typeof target.addEventListener === 'function')
    .forEach((target) => {
      const add = target.addEventListener;
      const remove = target.removeEventListener;
      Object.defineProperty(target, 'addEventListener', {
        configurable: true,
        writable: true,
        value: function trackedAddEventListener(type, listener, options) {
          if (listener && !added.some((entry) => same(entry, this, type, listener, options))) {
            added.push({
              target: this,
              type,
              listener,
              options,
              capture: capture(options),
              dependency: callingPackage(),
              remove,
            });
          }
          return add.call(this, type, listener, options);
        },
      });
      Object.defineProperty(target, 'removeEventListener', {
        configurable: true,
        writable: true,
        value: function trackedRemoveEventListener(type, listener, options) {
          added = added.filter((entry) => !same(entry, this, type, listener, options));
          return remove.call(this, type, listener, options);
        },
      });
    });
}

// Takes off what the file added. The listeners of libraries are kept, to come back with their package.
function releaseListeners() {
  added.forEach((entry) => {
    entry.remove.call(entry.target, entry.type, entry.listener, entry.options);
    if (entry.dependency && !dependencyListeners.some((kept) => kept.listener === entry.listener)) {
      dependencyListeners.push(entry);
    }
  });
  added = [];
}

const hasDependencyListeners = () => dependencyListeners.length > 0;

// Puts back the listeners of the packages a file imports (with its setup files).
function reattachListeners(imported) {
  dependencyListeners
    .filter(({ dependency }) => imported.has(dependency))
    .forEach(({ target, type, listener, options }) => target.addEventListener(type, listener, options));
}

module.exports = { trackListeners, releaseListeners, hasDependencyListeners, reattachListeners };
