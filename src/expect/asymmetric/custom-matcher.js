const { AsymmetricMatcher } = require('./asymmetric-matcher');
const { stringify } = require('../format');

// The asymmetric form of a matcher added with expect.extend(): expect.toBeWithinRange(1, 10).
class CustomMatcher extends AsymmetricMatcher {
  constructor(name, matcher, args, inverse, context) {
    super(name, args, inverse);
    this.matcher = matcher;
    this.context = context;
  }

  asymmetricMatch(other) {
    const { pass } = this.matcher.call(this.context, other, ...this.sample);
    return this.resolve(pass);
  }

  toAsymmetricMatcher() {
    const args = this.sample.map((arg) => stringify(arg)).join(', ');
    return args ? `${this.toString()}<${args}>` : this.toString();
  }
}

module.exports = { CustomMatcher };
