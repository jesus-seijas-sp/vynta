const { Any } = require('./any');
const { Anything } = require('./anything');
const { ArrayContaining } = require('./array-containing');
const { CloseTo } = require('./close-to');
const { CustomMatcher } = require('./custom-matcher');
const { ObjectContaining } = require('./object-containing');
const { StringContaining } = require('./string-containing');
const { StringMatching } = require('./string-matching');

const asymmetric = {
  any: (sample) => new Any(sample),
  anything: () => new Anything(),
  objectContaining: (sample) => new ObjectContaining(sample),
  arrayContaining: (sample) => new ArrayContaining(sample),
  stringContaining: (sample) => new StringContaining(sample),
  stringMatching: (sample) => new StringMatching(sample),
  closeTo: (sample, precision) => new CloseTo(sample, precision),
  not: {
    objectContaining: (sample) => new ObjectContaining(sample, true),
    arrayContaining: (sample) => new ArrayContaining(sample, true),
    stringContaining: (sample) => new StringContaining(sample, true),
    stringMatching: (sample) => new StringMatching(sample, true),
    closeTo: (sample, precision) => new CloseTo(sample, precision, true),
  },
};

module.exports = { asymmetric, CustomMatcher };
