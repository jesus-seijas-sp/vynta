const { add } = require('./math');

module.exports = { total: (numbers) => numbers.reduce((sum, n) => add(sum, n), 0) };
