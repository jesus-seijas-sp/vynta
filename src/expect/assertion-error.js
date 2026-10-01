class AssertionError extends Error {
  constructor(message, matcherResult) {
    super(message);
    this.name = 'AssertionError';
    this.matcherResult = matcherResult;
  }

  // Gives the error the stack of another one: where the assertion was written, for assertions that end later.
  withStackOf(source) {
    this.stack = `${this.name}: ${this.message}\n${source.stack.split('\n').slice(1).join('\n')}`;
    return this;
  }
}

module.exports = { AssertionError };
