const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BIN = path.join(__dirname, '..', '..', 'bin', 'vyntra.js');
const FIXTURES = path.join(__dirname, '..', 'fixtures');

// Runs vyntra on a fixture project (a name in test/fixtures, or a directory) and returns its JSON report, with the
// tests of every file flattened as { 'describe > test': record }.
function runFixture(name, args = []) {
  const root = path.isAbsolute(name) ? name : path.join(FIXTURES, name);
  const { stdout, stderr } = spawnSync(
    process.execPath,
    [BIN, '--root', root, '--reporter', 'json', '--no-color', ...args],
    { encoding: 'utf8', env: { ...process.env, CI: '' } }
  );
  const line = stdout.split('\n').find((text) => text.startsWith('{"success"'));
  if (!line) {
    throw new Error(`No report from vyntra:\n${stdout}\n${stderr}`);
  }
  const report = JSON.parse(line);
  const tests = Object.fromEntries(
    report.files.flatMap((file) => file.tests.map((test) => [test.path.join(' > '), test]))
  );
  const statuses = Object.fromEntries(Object.entries(tests).map(([key, test]) => [key, test.status]));
  return { ...report, tests, statuses };
}

// A copy of a fixture in a temporary directory, for tests that write files (snapshots).
function copyFixture(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `vyntra-${name}-`));
  fs.cpSync(path.join(FIXTURES, name), dir, { recursive: true });
  return dir;
}

module.exports = { runFixture, copyFixture };
