module.exports = {
  transform: {
    '\.js$': ['<rootDir>/transformer.js', { word: 'transformed' }],
  },
  transformIgnorePatterns: ['<rootDir>/transformer\.js$', '/node_modules/'],
  modulePathIgnorePatterns: ['<rootDir>/ignored'],
};
