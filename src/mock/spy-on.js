const { isClass } = require('../utils/is-class');
const { exportSetter } = require('../modules/spyable');
const { fn, isMockFunction, registerSpy } = require('./mock-function');

// Finds the property on the object or its prototype chain: { owner, descriptor }.
function findProperty(object, key) {
  for (let owner = object; owner; owner = Object.getPrototypeOf(owner)) {
    const descriptor = Object.getOwnPropertyDescriptor(owner, key);
    if (descriptor) {
      return { owner, descriptor };
    }
  }
  return {};
}

// Puts the property back as it was: an own property is redefined, an inherited one is uncovered again.
function restoreProperty(object, key, descriptor, isOwn) {
  if (!isOwn) {
    delete object[key];
  } else if (!descriptor.configurable && descriptor.writable) {
    object[key] = descriptor.value;
  } else {
    Object.defineProperty(object, key, descriptor);
  }
}

// A spied class keeps its static members and prototype.
function copyStatics(spy, original) {
  Object.getOwnPropertyNames(original)
    .filter((key) => !(key in spy) && !['prototype', 'length', 'name'].includes(key))
    .forEach((key) => {
      try {
        Object.defineProperty(spy, key, Object.getOwnPropertyDescriptor(original, key));
      } catch {
        // Not configurable: left out.
      }
    });
  if (original.prototype) {
    spy.prototype = original.prototype;
  }
}

function spyOnAccessor(object, key, descriptor, isOwn, accessType) {
  const accessor = descriptor[accessType];
  // A plain value spied as a getter or setter (a class field mocked through its getter): vitest makes it an
  // accessor with no implementation until the test gives one; Jest throws, which no test can be counting on.
  if (accessor === undefined && 'value' in descriptor) {
    const spy = fn().mockName(String(key));
    Object.defineProperty(object, key, {
      configurable: true,
      enumerable: descriptor.enumerable,
      [accessType]: spy,
    });
    registerSpy(spy, undefined, () => restoreProperty(object, key, descriptor, isOwn));
    return spy;
  }
  if (typeof accessor !== 'function') {
    throw new Error(`${String(key)} property does not have access type ${accessType}`);
  }
  if (isMockFunction(accessor)) {
    return accessor;
  }
  const spy = fn(accessor).mockName(String(key));
  Object.defineProperty(object, key, { ...descriptor, configurable: true, [accessType]: spy });
  registerSpy(spy, accessor, () => restoreProperty(object, key, descriptor, isOwn));
  return spy;
}

// An export of a module made spyable (see modules/spyable.js): the spy goes in through the module.
function spyOnExport(namespace, key, setExport) {
  const original = namespace[key];
  if (isMockFunction(original)) {
    return original;
  }
  const spy = fn(function spied(...args) {
    return original.apply(this, args);
  }).mockName(String(key));
  setExport(spy);
  registerSpy(spy, original, () => setExport(original));
  return spy;
}

function spyOn(object, key, accessType) {
  if (object === null || (typeof object !== 'object' && typeof object !== 'function')) {
    throw new Error(`Cannot spy on the ${String(key)} property of ${String(object)}`);
  }
  const setExport = exportSetter(object, key);
  if (setExport) {
    return spyOnExport(object, key, setExport);
  }
  const { owner, descriptor } = findProperty(object, key);
  if (!descriptor) {
    throw new Error(`${String(key)} property does not exist`);
  }
  const isOwn = owner === object;
  if (accessType === 'get' || accessType === 'set') {
    return spyOnAccessor(object, key, descriptor, isOwn, accessType);
  }
  const original = descriptor.get ? object[key] : descriptor.value;
  if (isMockFunction(original)) {
    return original;
  }
  if (typeof original !== 'function') {
    throw new TypeError(
      `Cannot spy on the ${String(key)} property because it is not a function; ${typeof original} given instead`
    );
  }
  // Calls through to the original; a class needs a subclass, as class constructors can only be constructed.
  const callThrough = isClass(original)
    ? class extends original {}
    : function spied(...args) {
        return original.apply(this, args);
      };
  const spy = fn(callThrough).mockName(String(key));
  copyStatics(spy, original);
  if (descriptor.get) {
    Object.defineProperty(object, key, { configurable: true, enumerable: descriptor.enumerable, get: () => spy });
  } else if (isOwn && !descriptor.configurable && descriptor.writable) {
    object[key] = spy;
  } else {
    Object.defineProperty(object, key, {
      configurable: true,
      enumerable: descriptor.enumerable,
      writable: true,
      value: spy,
    });
  }
  registerSpy(spy, original, () => restoreProperty(object, key, descriptor, isOwn));
  return spy;
}

module.exports = { spyOn };
