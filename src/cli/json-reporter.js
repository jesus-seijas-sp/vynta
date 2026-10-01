// Prints the whole run as one JSON document when it ends, for tools (and vyntra's own tests).
class JsonReporter {
  constructor(config, out = process.stdout) {
    this.config = config;
    this.out = out;
    this.results = [];
  }

  // Nothing to print until the end.
  // eslint-disable-next-line class-methods-use-this
  onStart() {}

  onFileResult(result) {
    this.results.push(result);
  }

  onFinish(duration) {
    const failed = (result) => result.errors.length > 0 || result.tests.some((test) => test.status === 'failed');
    const success = !this.results.some(failed);
    this.out.write(`${JSON.stringify({ success, duration, files: this.results })}\n`);
    return success;
  }
}

module.exports = { JsonReporter };
