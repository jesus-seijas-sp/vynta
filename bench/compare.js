// Wall-clock comparison of test runners: node bench/compare.js <runs> '<name>::<command>' ...
// Each command runs once to warm the disk cache, then <runs> times; prints min / median / max.
const { spawnSync } = require('node:child_process');

const [runsArg, ...specs] = process.argv.slice(2);
const runs = Number(runsArg) || 5;

function time(command) {
  const start = process.hrtime.bigint();
  const { status } = spawnSync(command, { shell: true, stdio: 'ignore' });
  return { ms: Number(process.hrtime.bigint() - start) / 1e6, status };
}

const results = specs.map((spec) => {
  // 'name::command', or 'name=command' when the name has no "=".
  const separator = spec.includes('::') ? '::' : '=';
  const at = spec.indexOf(separator);
  const name = spec.slice(0, at);
  const command = spec.slice(at + separator.length);
  time(command);
  const samples = Array.from({ length: runs }, () => time(command));
  const failed = samples.filter((sample) => sample.status !== 0).length;
  const ms = samples.map((sample) => sample.ms).sort((a, b) => a - b);
  return { name, min: ms[0], median: ms[Math.floor(ms.length / 2)], max: ms.at(-1), failed };
});

const fastest = Math.min(...results.map((result) => result.median));
results.forEach(({ name, min, median, max, failed }) => {
  const ratio = (median / fastest).toFixed(2);
  process.stdout.write(
    `${name.padEnd(22)} median ${median.toFixed(0).padStart(6)}ms  min ${min.toFixed(0).padStart(6)}ms  max ${max.toFixed(0).padStart(6)}ms  x${ratio}${failed ? `  (${failed} runs failed)` : ''}\n`
  );
});
