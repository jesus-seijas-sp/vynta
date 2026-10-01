// Thrown by context.skip() to stop a test and mark it as skipped.
class SkipError extends Error {
  constructor(note = 'skipped') {
    super(note);
    this.name = 'SkipError';
  }
}

module.exports = { SkipError };
