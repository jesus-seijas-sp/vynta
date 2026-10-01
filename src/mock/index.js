const { fn, isMockFunction, clearAllMocks, resetAllMocks, restoreAllMocks, releaseMocks } = require('./mock-function');
const { spyOn } = require('./spy-on');

module.exports = { fn, spyOn, isMockFunction, clearAllMocks, resetAllMocks, restoreAllMocks, releaseMocks };
