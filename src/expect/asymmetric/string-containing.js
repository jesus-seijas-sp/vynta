const { AsymmetricMatcher } = require('./asymmetric-matcher');

class StringContaining extends AsymmetricMatcher {
  constructor(sample, inverse) {
    if (typeof sample !== 'string') {
      throw new Error('Expected is not a string');
    }
    super('StringContaining', sample, inverse);
  }

  asymmetricMatch(other) {
    return this.resolve(typeof other === 'string' && other.includes(this.sample));
  }
}

module.exports = { StringContaining };
