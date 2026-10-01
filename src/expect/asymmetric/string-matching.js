const { AsymmetricMatcher } = require('./asymmetric-matcher');

class StringMatching extends AsymmetricMatcher {
  constructor(sample, inverse) {
    if (typeof sample !== 'string' && !(sample instanceof RegExp)) {
      throw new Error('Expected is not a String or a RegExp');
    }
    super('StringMatching', new RegExp(sample), inverse);
  }

  asymmetricMatch(other) {
    return this.resolve(typeof other === 'string' && this.sample.test(other));
  }

  toAsymmetricMatcher() {
    return `${this.toString()} ${this.sample}`;
  }
}

module.exports = { StringMatching };
