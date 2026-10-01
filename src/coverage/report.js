const fs = require('node:fs');
const path = require('node:path');
const { colors: c } = require('../colors');
const { fileCoverage, summarize, uncoveredLines } = require('./file-coverage');

const METRICS = ['statements', 'branches', 'functions', 'lines'];
const HEADERS = ['% Stmts', '% Branch', '% Funcs', '% Lines'];

const percent = ({ total, covered }) => (total === 0 ? 100 : (covered / total) * 100);

function colorFor(value) {
  if (value >= 80) {
    return c.green;
  }
  return value >= 50 ? c.yellow : c.red;
}

function addSummaries(summaries) {
  return Object.fromEntries(
    METRICS.map((metric) => [
      metric,
      summaries.reduce(
        (sum, summary) => ({
          total: sum.total + summary[metric].total,
          covered: sum.covered + summary[metric].covered,
        }),
        { total: 0, covered: 0 }
      ),
    ])
  );
}

// The table Jest prints: one row per file and one for all of them.
function textTable(rows, total, maxUncovered = 40) {
  const nameWidth = Math.max('All files'.length, ...rows.map((row) => row.name.length));
  const cell = (value, width) => colorFor(value)(value.toFixed(2).padStart(width));
  const line = (name, summary, uncovered = '') => {
    const cells = METRICS.map((metric, i) => cell(percent(summary[metric]), HEADERS[i].length));
    const shown = uncovered.length > maxUncovered ? `${uncovered.slice(0, maxUncovered - 3)}...` : uncovered;
    return `${name.padEnd(nameWidth)} | ${cells.join(' | ')} | ${c.red(shown)}`;
  };
  const separator = `${'-'.repeat(nameWidth)}-|-${HEADERS.map((h) => '-'.repeat(h.length)).join('-|-')}-|-${'-'.repeat(20)}`;
  return [
    separator,
    `${'File'.padEnd(nameWidth)} | ${HEADERS.join(' | ')} | Uncovered Line #s`,
    separator,
    line('All files', total),
    ...rows.map((row) => line(row.name, row.summary, row.uncovered)),
    separator,
  ].join('\n');
}

function lcov(files) {
  return files
    .map(({ file, lines, functions, branches }) => {
      const out = [`SF:${file}`];
      functions.forEach(({ name, line }) => out.push(`FN:${line},${name}`));
      functions.forEach(({ name, count }) => out.push(`FNDA:${count},${name}`));
      out.push(`FNF:${functions.length}`, `FNH:${functions.filter(({ count }) => count > 0).length}`);
      branches.forEach(({ line, count }, i) => out.push(`BRDA:${line},${i},0,${count > 0 ? count : '-'}`));
      out.push(`BRF:${branches.length}`, `BRH:${branches.filter(({ count }) => count > 0).length}`);
      lines.forEach((hits, line) => out.push(`DA:${line},${hits}`));
      const covered = [...lines.values()].filter((hits) => hits > 0).length;
      out.push(`LF:${lines.size}`, `LH:${covered}`, 'end_of_record');
      return out.join('\n');
    })
    .join('\n');
}

// Jest's coverageThreshold.global: { lines: 80, ... }, a negative number being a maximum of uncovered items.
function thresholdFailures(total, thresholds = {}) {
  return METRICS.filter((metric) => thresholds[metric] !== undefined).flatMap((metric) => {
    const expected = thresholds[metric];
    const actual = percent(total[metric]);
    const uncovered = total[metric].total - total[metric].covered;
    if (expected >= 0 && actual < expected) {
      return [`Coverage for ${metric} (${actual.toFixed(2)}%) does not meet the threshold (${expected}%)`];
    }
    if (expected < 0 && uncovered > -expected) {
      return [`Uncovered count for ${metric} (${uncovered}) exceeds the maximum allowed (${-expected})`];
    }
    return [];
  });
}

// Prints and writes the coverage report; returns whether the thresholds are met.
function reportCoverage(coverage, config, out = process.stdout) {
  const include = config.coverageInclude;
  const files = Object.entries(coverage)
    .filter(([file]) => !include || include(file))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, data]) => fileCoverage(file, data));
  const rows = files.map((data) => ({
    name: path.relative(config.rootDir, data.file).split(path.sep).join('/'),
    summary: summarize(data),
    uncovered: uncoveredLines(data.lines),
  }));
  const total = addSummaries(rows.map((row) => row.summary));
  const reporters = config.coverageReporters ?? ['text', 'lcov'];
  if (reporters.includes('text')) {
    out.write(`${textTable(rows, total)}\n`);
  }
  if (reporters.includes('lcov') || reporters.includes('lcovonly')) {
    const dir = path.resolve(config.rootDir, config.coverageDirectory ?? 'coverage');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'lcov.info'), `${lcov(files)}\n`);
  }
  const failures = thresholdFailures(total, config.coverageThreshold?.global);
  failures.forEach((failure) => out.write(`${c.red(`ERROR: ${failure}`)}\n`));
  return failures.length === 0;
}

module.exports = { reportCoverage };
