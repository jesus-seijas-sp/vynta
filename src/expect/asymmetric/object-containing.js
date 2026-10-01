const { AsymmetricMatcher } = require('./asymmetric-matcher');
const { equals } = require('../equals');

// Own or inherited property, as Jest checks it.
function hasProperty(obj, key) {
  for (let current = obj; current !== null && current !== undefined; current = Object.getPrototypeOf(current)) {
    if (Object.hasOwn(current, key)) {
      return true;
    }
  }
  return false;
}

class ObjectContaining extends AsymmetricMatcher {
  constructor(sample, inverse) {
    super('ObjectContaining', sample, inverse);
  }

  asymmetricMatch(other) {
    if (typeof this.sample !== 'object' || this.sample === null) {
      throw new Error(`You must provide an object to ObjectContaining, not '${typeof this.sample}'.`);
    }
    const keys = [...Object.keys(this.sample), ...Object.getOwnPropertySymbols(this.sample)];
    const result =
      other !== null &&
      other !== undefined &&
      keys.every((key) => hasProperty(other, key) && equals(other[key], this.sample[key]));
    return this.resolve(result);
  }
}

module.exports = { ObjectContaining };
