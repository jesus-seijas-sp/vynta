// From whatever/fun/is-class.js.
function isClass(obj) {
  return typeof obj === 'function' && /^\s*class\b/.test(Function.prototype.toString.call(obj));
}

module.exports = { isClass };
