const { AsymmetricMatcher } = require('./asymmetric-matcher');

class CloseTo extends AsymmetricMatcher {
  constructor(sample, precision = 2, inverse = false) {
    if (typeof sample !== 'number') {
      throw new Error('Expected is not a Number');
    }
    super('NumberCloseTo', sample, inverse);
    this.precision = precision;
  }

  asymmetricMatch(other) {
    if (typeof other !== 'number') {
      return false;
    }
    // Infinity - Infinity is NaN, so equal infinities are caught by the first check.
    return this.resolve(other === this.sample || Math.abs(this.sample - other) < 10 ** -this.precision / 2);
  }

  toAsymmetricMatcher() {
    return `${this.toString()} ${this.sample} (${this.precision} digits)`;
  }
}

module.exports = { CloseTo };
