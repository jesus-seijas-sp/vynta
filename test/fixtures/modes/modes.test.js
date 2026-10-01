describe('plain', () => {
  it('passes', () => {});
  it('fails', () => {
    expect(1).toBe(2);
  });
  it.skip('is skipped', () => {});
  it.todo('is todo');
  it.fails('fails as expected', () => {
    expect(1).toBe(2);
  });
  it.fails('passes unexpectedly', () => {});
  it.skipIf(true)('skipIf true', () => {});
  it.runIf(true)('runIf true', () => {});
  it('skips itself', (context) => {
    context.skip();
  });
});

describe.skip('skipped describe', () => {
  it('inside', () => {});
});

describe('each', () => {
  it.each([
    [1, 2, 3],
    [2, 2, 4],
  ])('%i + %i = %i', (a, b, c) => {
    expect(a + b).toBe(c);
  });
  it.each([{ name: 'ann', age: 3 }])('$name is $age', ({ age }) => {
    expect(age).toBe(3);
  });
  it.each`
    a    | b    | sum
    ${1} | ${1} | ${2}
  `('template $a + $b', ({ a, b, sum }) => {
    expect(a + b).toBe(sum);
  });
  it.for([[5, 5]])('for %i %i', ([a, b], context) => {
    context.expect(a).toBe(b);
  });
  describe.each(['x', 'y'])('describe %s', (letter) => {
    it('has the letter', () => {
      expect(typeof letter).toBe('string');
    });
  });
});

describe('async', () => {
  it('done callback', (done) => {
    setTimeout(done, 5);
  });
  it('done with error', (done) => {
    done(new Error('given to done'));
  });
  it('times out', () => new Promise(() => {}), 50);
  it('uncaught error', async () => {
    setTimeout(() => {
      throw new Error('uncaught');
    }, 1);
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
  });
  it('unawaited rejects', () => {
    expect(Promise.resolve(1)).rejects.toThrow();
  });
});

describe('assertion counts', () => {
  it('assertions ok', () => {
    expect.assertions(1);
    expect(1).toBe(1);
  });
  it('assertions wrong', () => {
    expect.assertions(2);
    expect(1).toBe(1);
  });
  it('hasAssertions', () => {
    expect.hasAssertions();
  });
});

let attempts = 0;
describe('retry', () => {
  it('passes on the third attempt', { retry: 2 }, () => {
    attempts += 1;
    expect(attempts).toBe(3);
  });
});
