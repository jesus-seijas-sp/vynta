const { spawnSync, spawn } = require('node:child_process');

// A shell running a command with the streams of the test (Yarn's): a worker thread's own streams are no stdio for
// a child, which gets no input and writes where the process does.
test("a child process can be given the test's own stdin and stdout", async () => {
  const child = spawn(process.execPath, ['-e', 'process.exitCode = 3'], {
    stdio: [process.stdin, process.stdout, 'pipe'],
  });
  const code = await new Promise((resolve) => {
    child.on('exit', resolve);
  });
  expect(code).toBe(3);
  expect(spawnSync(process.execPath, ['-e', '0']).status).toBe(0);
});
