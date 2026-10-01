const { AsymmetricMatcher } = require('./asymmetric-matcher');

class Anything extends AsymmetricMatcher {
  constructor() {
    super('Anything');
  }

  asymmetricMatch(other) {
    return this.resolve(other !== null && other !== undefined);
  }

  toAsymmetricMatcher() {
    return this.toString();
  }
}

module.exports = { Anything };
