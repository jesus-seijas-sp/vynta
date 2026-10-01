const collections = require('./collections');
const equality = require('./equality');
const mocks = require('./mocks');
const numbers = require('./numbers');
const throwing = require('./throw');
const values = require('./values');

// Every matcher is called with `this` set to a MatcherContext and returns { pass, message }. The message is a
// function, so nothing is formatted unless the assertion fails.
const matchers = { ...equality, ...values, ...numbers, ...collections, ...throwing, ...mocks };

// Old Jest names and vitest names of the same matchers.
const ALIASES = {
  toBeCalled: 'toHaveBeenCalled',
  toBeCalledTimes: 'toHaveBeenCalledTimes',
  toBeCalledWith: 'toHaveBeenCalledWith',
  toBeCalledOnce: 'toHaveBeenCalledOnce',
  lastCalledWith: 'toHaveBeenLastCalledWith',
  nthCalledWith: 'toHaveBeenNthCalledWith',
  toReturn: 'toHaveReturned',
  toReturnTimes: 'toHaveReturnedTimes',
  toReturnWith: 'toHaveReturnedWith',
  lastReturnedWith: 'toHaveLastReturnedWith',
  nthReturnedWith: 'toHaveNthReturnedWith',
};

Object.entries(ALIASES).forEach(([alias, name]) => {
  matchers[alias] = matchers[name];
});

module.exports = { matchers };
