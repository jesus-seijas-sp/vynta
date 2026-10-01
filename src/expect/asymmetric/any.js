const { AsymmetricMatcher } = require('./asymmetric-matcher');

// Primitive wrappers match the primitive values as well as their boxed objects.
const PRIMITIVES = new Map([
  [String, 'string'],
  [Number, 'number'],
  [Boolean, 'boolean'],
  [BigInt, 'bigint'],
  [Symbol, 'symbol'],
  [Function, 'function'],
]);

class Any extends AsymmetricMatcher {
  constructor(sample) {
    if (sample === undefined) {
      throw new TypeError(
        'any() expects to be passed a constructor function. Please pass one or use anything() to match any object.'
      );
    }
    super('Any', sample);
  }

  asymmetricMatch(other) {
    const type = PRIMITIVES.get(this.sample);
    if (type) {
      // eslint-disable-next-line valid-typeof -- type is one of the names in PRIMITIVES
      return typeof other === type || other instanceof this.sample;
    }
    if (this.sample === Object) {
      return typeof other === 'object' && other !== null;
    }
    return other instanceof this.sample;
  }

  toAsymmetricMatcher() {
    return `Any<${this.sample?.name ?? String(this.sample)}>`;
  }
}

module.exports = { Any };
