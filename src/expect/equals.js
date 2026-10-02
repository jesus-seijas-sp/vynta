// Deep equality with the semantics of Jest's `equals` (toEqual and, with strict, toStrictEqual). It is the hot path of
// most test suites, so primitives are decided before any allocation and dense arrays and plain objects skip the
// generic code.

const customTesters = [];
// The `this` of custom testers; its equals is set below, once defined.
const testerContext = {};

const isAsymmetric = (value) =>
  value !== null && typeof value === 'object' && typeof value.asymmetricMatch === 'function';

const isObject = (value) => value !== null && typeof value === 'object';

function asymmetricMatch(a, b) {
  const aIs = isAsymmetric(a);
  const bIs = isAsymmetric(b);
  if (aIs === bIs) {
    return undefined;
  }
  return aIs ? a.asymmetricMatch(b) : b.asymmetricMatch(a);
}

// Own enumerable keys, strings first and then symbols.
function keysOf(obj) {
  const keys = Object.keys(obj);
  const symbols = Object.getOwnPropertySymbols(obj);
  for (let i = 0; i < symbols.length; i += 1) {
    if (Object.prototype.propertyIsEnumerable.call(obj, symbols[i])) {
      keys.push(symbols[i]);
    }
  }
  return keys;
}

function bytesEqual(a, b) {
  const x = ArrayBuffer.isView(a) ? new Uint8Array(a.buffer, a.byteOffset, a.byteLength) : new Uint8Array(a);
  const y = ArrayBuffer.isView(b) ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength) : new Uint8Array(b);
  if (x.length !== y.length) {
    return false;
  }
  for (let i = 0; i < x.length; i += 1) {
    if (x[i] !== y[i]) {
      return false;
    }
  }
  return true;
}

// For toStrictEqual: same class, a plain object and a null-prototype one being the same type.
function sameType(a, b) {
  const pa = Object.getPrototypeOf(a);
  const pb = Object.getPrototypeOf(b);
  if (pa === pb) {
    return true;
  }
  const plain = (proto) => proto === null || proto === Object.prototype;
  return plain(pa) && plain(pb);
}

class Comparison {
  constructor(testers, strict) {
    this.testers = testers;
    this.strict = strict;
    this.aStack = [];
    this.bStack = [];
  }

  eq(a, b) {
    if (this.testers.length === 0 && (!isObject(a) || !isObject(b))) {
      // A primitive can not be an asymmetric matcher, only the other side can.
      if (isAsymmetric(a)) {
        return a.asymmetricMatch(b);
      }
      if (isAsymmetric(b)) {
        return b.asymmetricMatch(a);
      }
      return Object.is(a, b);
    }
    const asymmetric = asymmetricMatch(a, b);
    if (asymmetric !== undefined) {
      return asymmetric;
    }
    for (let i = 0; i < this.testers.length; i += 1) {
      const result = this.testers[i].call(testerContext, a, b, this.testers);
      if (result !== undefined) {
        return result;
      }
    }
    if (a instanceof Error && b instanceof Error) {
      return a.message === b.message;
    }
    if (Object.is(a, b)) {
      return true;
    }
    if (a === null || b === null) {
      return false;
    }
    const tag = Object.prototype.toString.call(a);
    if (tag !== Object.prototype.toString.call(b)) {
      return false;
    }
    const special = this.compareSpecial(a, b, tag);
    if (special !== undefined) {
      return special;
    }
    if (typeof a !== 'object' || typeof b !== 'object' || (this.strict && !sameType(a, b))) {
      return false;
    }
    return this.compareTracked(a, b, tag);
  }

  // Types compared by value rather than by their keys; undefined for the others.
  compareSpecial(a, b, tag) {
    switch (tag) {
      case '[object Boolean]':
      case '[object String]':
      case '[object Number]':
        // Both must be boxed primitives (new Number(1)), a primitive never equals its box.
        return typeof a === 'object' && typeof b === 'object' && Object.is(a.valueOf(), b.valueOf());
      case '[object Date]':
        return +a === +b;
      case '[object RegExp]':
        return a.source === b.source && a.flags === b.flags;
      case '[object URL]':
        return a.href === b.href;
      case '[object ArrayBuffer]':
      case '[object SharedArrayBuffer]':
      case '[object DataView]':
        return (!this.strict || sameType(a, b)) && bytesEqual(a, b);
      default:
        return undefined;
    }
  }

  // Compares two objects keeping track of the ones being visited, for circular references.
  compareTracked(a, b, tag) {
    const { aStack, bStack } = this;
    for (let i = aStack.length - 1; i >= 0; i -= 1) {
      if (aStack[i] === a) {
        return bStack[i] === b;
      }
      if (bStack[i] === b) {
        return false;
      }
    }
    aStack.push(a);
    bStack.push(b);
    const result = this.compareObjects(a, b, tag);
    aStack.pop();
    bStack.pop();
    return result;
  }

  compareObjects(a, b, tag) {
    if (tag === '[object Array]') {
      if (a.length !== b.length) {
        return false;
      }
      const dense = this.strict ? undefined : this.denseArraysEqual(a, b);
      return dense ?? this.keysEqual(a, b);
    }
    if (tag === '[object Map]' || tag === '[object Set]') {
      return this.collectionsEqual(a, b) && this.keysEqual(a, b);
    }
    const iterable =
      typeof a[Symbol.iterator] === 'function' &&
      typeof b[Symbol.iterator] === 'function' &&
      !ArrayBuffer.isView(a) &&
      tag !== '[object Object]' &&
      tag !== '[object Arguments]';
    return iterable ? this.iterablesEqual(a, b) : this.keysEqual(a, b);
  }

  // Arrays with no holes and no extra properties are compared by index; undefined for the others.
  denseArraysEqual(a, b) {
    if (Object.keys(a).length !== a.length || Object.keys(b).length !== b.length) {
      return undefined;
    }
    for (let i = 0; i < a.length; i += 1) {
      if (!this.eq(a[i], b[i])) {
        return false;
      }
    }
    return true;
  }

  // Maps and Sets are equal regardless of their order.
  collectionsEqual(a, b) {
    if (a.size !== b.size) {
      return false;
    }
    const others = [...b];
    if (a instanceof Set) {
      return [...a].every((value) => b.has(value) || others.some((other) => this.eq(value, other)));
    }
    return [...a].every(
      ([key, value]) =>
        (b.has(key) && this.eq(value, b.get(key))) ||
        others.some(([otherKey, otherValue]) => this.eq(key, otherKey) && this.eq(value, otherValue))
    );
  }

  iterablesEqual(a, b) {
    const left = [...a];
    const right = [...b];
    return left.length === right.length && left.every((value, i) => this.eq(value, right[i]));
  }

  keysEqual(a, b) {
    const aKeys = keysOf(a);
    const bKeys = keysOf(b);
    if (!this.strict) {
      // An undefined property or an asymmetric matcher may be missing on the other side.
      const optional = (obj, other, key) =>
        (obj[key] === undefined || isAsymmetric(obj[key])) && !Object.prototype.hasOwnProperty.call(other, key);
      const aExtra = bKeys.filter((key) => optional(b, a, key));
      const bExtra = aKeys.filter((key) => optional(a, b, key));
      aKeys.push(...aExtra);
      bKeys.push(...bExtra);
    }
    if (aKeys.length !== bKeys.length) {
      return false;
    }
    for (let i = aKeys.length - 1; i >= 0; i -= 1) {
      const key = aKeys[i];
      const present =
        Object.prototype.hasOwnProperty.call(b, key) ||
        (!this.strict && (isAsymmetric(a[key]) || a[key] === undefined));
      if (!present || !this.eq(a[key], b[key])) {
        return false;
      }
    }
    // For toStrictEqual a hole is not an undefined value.
    if (this.strict && Array.isArray(a)) {
      for (let i = 0; i < a.length; i += 1) {
        if (Object.prototype.hasOwnProperty.call(a, i) !== Object.prototype.hasOwnProperty.call(b, i)) {
          return false;
        }
      }
    }
    return true;
  }
}

function equals(a, b, testers = [], strict = false) {
  const all = testers.length > 0 ? [...testers, ...customTesters] : customTesters;
  return new Comparison(all, strict).eq(a, b);
}

testerContext.equals = equals;

function addEqualityTesters(testers) {
  customTesters.push(...testers);
}

const isContainer = (value) =>
  value instanceof Date || value instanceof RegExp || value instanceof Map || value instanceof Set;

// toMatchObject: every property of object is in received, recursively; arrays must have the same length.
function subsetEquals(received, object, seen = new WeakMap()) {
  if (!isObject(object) || isAsymmetric(object) || isContainer(object)) {
    return equals(received, object);
  }
  // As in Jest (and vitest): every key of an object must match, so one with no keys, { value: {} }, matches any
  // received value, even one that is not an object.
  if (!isObject(received)) {
    return !Array.isArray(object) && keysOf(object).length === 0;
  }
  if (Array.isArray(object)) {
    return (
      Array.isArray(received) &&
      received.length === object.length &&
      object.every((item, i) => subsetEquals(received[i], item, seen))
    );
  }
  if (seen.get(object) === received) {
    return true;
  }
  seen.set(object, received);
  return keysOf(object).every((key) => key in received && subsetEquals(received[key], object[key], seen));
}

module.exports = { equals, subsetEquals, addEqualityTesters, isAsymmetric, customTesters };
