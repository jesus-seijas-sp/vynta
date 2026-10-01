const path = require('node:path');
const { Session } = require('node:inspector');
const { fileURLToPath } = require('node:url');

const RUNTIME_DIR = path.join(__dirname, '..');
const NODE_MODULES = `${path.sep}node_modules${path.sep}`;

function toPath(url) {
  if (!url.startsWith('file:')) {
    return path.isAbsolute(url) ? url : null;
  }
  try {
    return fileURLToPath(url.replace(/\?.*$/, ''));
  } catch {
    return null;
  }
}

// Count of every character of a script: its ranges applied from the outermost to the innermost. V8 leaves out the
// nested ranges with the same count as their parent, so ranges can only be merged once resolved like this.
function characterCounts(length, ranges) {
  const counts = new Float64Array(length);
  [...ranges]
    .sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset)
    .forEach(({ startOffset, endOffset, count }) => {
      counts.fill(count, startOffset, Math.min(endOffset, length));
    });
  return counts;
}

// The coverage of a file: { counts, functions: Map, blocks: Map }, the maps keyed by "start:end".
function emptyCoverage(length) {
  return { counts: new Float64Array(length), functions: new Map(), blocks: new Map() };
}

// Adds b into a, growing a when b is longer.
function addCounts(a, b) {
  const target = a.length >= b.length ? a : Float64Array.from({ length: b.length }, (_, i) => a[i] ?? 0);
  for (let i = 0; i < b.length; i += 1) {
    target[i] += b[i];
  }
  return target;
}

function addScript(files, file, functions) {
  const ranges = functions.flatMap((fn) => fn.ranges);
  const length = Math.max(...ranges.map((range) => range.endOffset));
  const coverage = files.get(file) ?? emptyCoverage(length);
  coverage.counts = addCounts(coverage.counts, characterCounts(length, ranges));
  functions.forEach(({ functionName, ranges: [first, ...blocks] }) => {
    coverage.functions.set(`${first.startOffset}:${first.endOffset}`, {
      name: functionName,
      startOffset: first.startOffset,
      endOffset: first.endOffset,
    });
    blocks.forEach(({ startOffset, endOffset }) => {
      coverage.blocks.set(`${startOffset}:${endOffset}`, { startOffset, endOffset });
    });
  });
  files.set(file, coverage);
}

// V8's precise coverage of the code this thread runs: no instrumentation, V8 counts the blocks it executes.
class CoverageCollector {
  constructor({ rootDir, testFiles = [] }) {
    this.rootDir = rootDir;
    this.testFiles = new Set(testFiles);
    this.session = new Session();
    this.files = new Map();
  }

  post(method, params = {}) {
    const { promise, resolve, reject } = Promise.withResolvers();
    this.session.post(method, params, (error, result) => (error ? reject(error) : resolve(result)));
    return promise;
  }

  async start() {
    this.session.connect();
    await this.post('Profiler.enable');
    await this.post('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
  }

  // Project files only: not dependencies, not vyntra, not the test files themselves.
  includes(file) {
    return (
      file !== null &&
      file.startsWith(this.rootDir) &&
      !file.includes(NODE_MODULES) &&
      !file.startsWith(RUNTIME_DIR) &&
      !this.testFiles.has(file)
    );
  }

  // Takes the counts so far, which V8 then resets. Called after every test file, as the copies of the modules it
  // loaded are released.
  async take() {
    const { result } = await this.post('Profiler.takePreciseCoverage');
    result.forEach(({ url, functions }) => {
      const file = toPath(url);
      if (this.includes(file) && functions.length > 0) {
        addScript(this.files, file, functions);
      }
    });
  }

  async stop() {
    await this.take();
    await this.post('Profiler.stopPreciseCoverage');
    this.session.disconnect();
    return serialize(this.files);
  }
}

// For postMessage: plain objects and arrays.
function serialize(files) {
  return Object.fromEntries(
    [...files].map(([file, { counts, functions, blocks }]) => [
      file,
      { counts, functions: [...functions.values()], blocks: [...blocks.values()] },
    ])
  );
}

// Merges the coverage of several threads.
function mergeCoverage(results) {
  const files = new Map();
  results.forEach((result) => {
    Object.entries(result).forEach(([file, { counts, functions, blocks }]) => {
      const coverage = files.get(file) ?? emptyCoverage(counts.length);
      coverage.counts = addCounts(coverage.counts, counts);
      functions.forEach((fn) => coverage.functions.set(`${fn.startOffset}:${fn.endOffset}`, fn));
      blocks.forEach((block) => coverage.blocks.set(`${block.startOffset}:${block.endOffset}`, block));
      files.set(file, coverage);
    });
  });
  return serialize(files);
}

module.exports = { CoverageCollector, mergeCoverage };
