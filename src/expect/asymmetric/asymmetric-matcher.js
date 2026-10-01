const { stringify } = require('../format');

// Base of the matchers that can be used as expected values: expect.any(Number), expect.objectContaining({})...
class AsymmetricMatcher {
  constructor(name, sample, inverse = false) {
    this.$$typeof = Symbol.for('jest.asymmetricMatcher');
    this.name = name;
    this.sample = sample;
    this.inverse = inverse;
  }

  // Applies the inverse flag of expect.not.xxx() to a result.
  resolve(result) {
    return this.inverse ? !result : result;
  }

  toString() {
    return `${this.inverse ? 'Not' : ''}${this.name}`;
  }

  toAsymmetricMatcher() {
    return `${this.toString()} ${stringify(this.sample)}`;
  }
}

module.exports = { AsymmetricMatcher };
