import { describe, expect, it, onTestFinished, test } from 'vitest';

const finished = [];

const myTest = test.extend({
  number: 21,
  doubled: async ({ number }, use) => {
    await use(number * 2);
  },
  resource: async ({}, use) => {
    const resource = { open: true };
    await use(resource);
    resource.open = false;
    finished.push('resource closed');
  },
});

describe('fixtures', () => {
  myTest('gets values and derived fixtures', ({ number, doubled }) => {
    expect(number).toBe(21);
    expect(doubled).toBe(42);
  });

  myTest('tears fixtures down', ({ resource }) => {
    expect(resource.open).toBe(true);
    onTestFinished(() => finished.push('finished'));
  });

  it('ran the teardowns', () => {
    expect(finished).toEqual(['resource closed', 'finished']);
  });
});

describe('context', () => {
  it('has the task', ({ task }) => {
    expect(task.name).toBe('has the task');
  });

  it.concurrent('concurrent one', async ({ expect: localExpect }) => {
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
    localExpect(1).toBe(1);
  });

  it.concurrent('concurrent two', async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
  });
});
