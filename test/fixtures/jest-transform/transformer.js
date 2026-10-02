// A Jest transformer made with createTransformer, as babel-jest is: replaces WORD with the word of its options.
module.exports = {
  createTransformer: ({ word }) => ({
    getCacheKey: (source) => `${word}:${source}`,
    process: (source) => ({ code: source.replaceAll('WORD', JSON.stringify(word)) }),
  }),
};
