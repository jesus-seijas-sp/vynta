// Given with --config, as Strapi's packages give jest.config.front.js.
module.exports = {
  preset: './preset.js',
  setupFilesAfterEnv: ['<rootDir>/own-setup.js'],
};
