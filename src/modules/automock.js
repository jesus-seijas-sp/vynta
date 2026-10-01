const { fn } = require('../mock');

// Properties every function or object has, which a mock does not copy.
const RESERVED = new Set(['arguments', 'caller', 'callee', 'length', 'name', 'prototype', 'constructor', '__proto__']);
const BUILTIN_PROTOTYPES = new Set([Object.prototype, Function.prototype, RegExp.prototype, Array.prototype]);

// The members of a value as Jest's automock sees them: own properties, enumerable or not, and the ones inherited
// from its prototype chain (class methods, static methods of parent classes), without the built-in ones.
function slots(value) {
  const names = new Set();
  for (let owner = value; owner && !BUILTIN_PROTOTYPES.has(owner); owner = Object.getPrototypeOf(owner)) {
    Object.getOwnPropertyNames(owner)
      .filter((name) => !RESERVED.has(name))
      .forEach((name) => names.add(name));
  }
  return [...names];
}

// A member, or undefined when reading it throws (getters that need a real instance).
function read(value, name) {
  try {
    return value[name];
  } catch {
    return undefined;
  }
}

// The methods of a class: its prototype chain, up to Object.prototype.
const prototypeMethods = (Class) =>
  Class.prototype ? slots(Class.prototype).filter((name) => typeof read(Class.prototype, name) === 'function') : [];

// A module with every function replaced by a mock returning undefined, as Jest's automock: classes keep mocked
// methods (instance and static), objects are mocked deeply with their inherited methods, arrays become empty and
// primitives stay. With spy (vitest's { spy: true }) the mocks call the originals instead.
function automock(value, seen = new Map(), spy = false) {
  if (typeof value === 'function') {
    if (seen.has(value)) {
      return seen.get(value);
    }
    const mock = fn(spy ? value : undefined).mockName(value.name);
    seen.set(value, mock);
    prototypeMethods(value).forEach((name) => {
      mock.prototype[name] = fn(spy ? value.prototype[name] : undefined).mockName(name);
    });
    slots(value).forEach((name) => {
      mock[name] = automock(read(value, name), seen, spy);
    });
    return mock;
  }
  if (Array.isArray(value)) {
    return spy ? value : [];
  }
  if (value !== null && typeof value === 'object') {
    if (seen.has(value)) {
      return seen.get(value);
    }
    const result = {};
    seen.set(value, result);
    slots(value).forEach((name) => {
      result[name] = automock(read(value, name), seen, spy);
    });
    return result;
  }
  return value;
}

module.exports = { automock };
