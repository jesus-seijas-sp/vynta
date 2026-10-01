const { AsymmetricMatcher } = require('./asymmetric-matcher');
const { equals } = require('../equals');

class ArrayContaining extends AsymmetricMatcher {
  constructor(sample, inverse) {
    super('ArrayContaining', sample, inverse);
  }

  asymmetricMatch(other) {
    if (!Array.isArray(this.sample)) {
      throw new Error(`You must provide an array to ArrayContaining, not '${typeof this.sample}'.`);
    }
    const result =
      this.sample.length === 0 ||
      (Array.isArray(other) && this.sample.every((item) => other.some((another) => equals(item, another))));
    return this.resolve(result);
  }
}

module.exports = { ArrayContaining };
