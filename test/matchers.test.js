const { stripVTControlCharacters } = require('node:util');

// The message of the assertion error thrown by fn, without colors.
function failure(fn) {
  try {
    fn();
  } catch (error) {
    return stripVTControlCharacters(error.message);
  }
  throw new Error('The assertion did not fail');
}

describe('matchers', () => {
  it('pass when they should', () => {
    expect(1).toBe(1);
    expect({ a: [1] }).toEqual({ a: [1] });
    expect({ a: 1 }).toStrictEqual({ a: 1 });
    expect(undefined).toBeUndefined();
    expect(null).toBeNull();
    expect(0).toBeDefined();
    expect('x').toBeTruthy();
    expect('').toBeFalsy();
    expect(NaN).toBeNaN();
    expect(2).toBeGreaterThan(1);
    expect(2).toBeGreaterThanOrEqual(2);
    expect(1n).toBeLessThan(2n);
    expect(1).toBeLessThanOrEqual(1);
    expect(0.1 + 0.2).toBeCloseTo(0.3);
    expect(new Map()).toBeInstanceOf(Map);
    expect('s').toBeTypeOf('string');
    expect(2).toBeOneOf([1, 2]);
    expect(4).toSatisfy((n) => n % 2 === 0);
    expect([1, 2]).toContain(2);
    expect('abc').toContain('b');
    expect(new Set([1])).toContain(1);
    expect([{ a: 1 }]).toContainEqual({ a: 1 });
    expect('abc').toHaveLength(3);
    expect({ a: { b: [{ c: 1 }] } }).toHaveProperty('a.b[0].c', 1);
    expect({ a: { 'x.y': 1 } }).toHaveProperty(['a', 'x.y']);
    expect('hello').toMatch(/ell/);
    expect({ a: 1, b: 2 }).toMatchObject({ a: 1 });
    expect(() => {
      throw new TypeError('bad thing');
    }).toThrow(TypeError);
    expect(() => {
      throw new Error('bad thing');
    }).toThrowError(/thing$/);
  });

  it('pass negated when they should', () => {
    expect(1).not.toBe(2);
    expect([1]).not.toContain(2);
    expect({ a: 1 }).not.toHaveProperty('b');
    expect(() => {}).not.toThrow();
  });

  it('print what was expected and received', () => {
    expect(failure(() => expect(1).toBe(2))).toBe(
      'expect(received).toBe(expected) // Object.is equality\n\nExpected: 2\nReceived: 1'
    );
    expect(failure(() => expect([1]).not.toContain(1))).toBe(
      'expect(received).not.toContain(expected)\n\nExpected value: not 1\nReceived array:     [1]'
    );
    expect(failure(() => expect({ a: 1 }).toBe({ a: 1 }))).toMatch(
      'If it should pass with deep equality, replace "toBe" with "toStrictEqual"'
    );
  });

  it('print a diff of objects', () => {
    const message = failure(() => expect({ a: 1, b: [1, 2] }).toEqual({ a: 1, b: [1, 3] }));
    expect(message).toBe(
      [
        'expect(received).toEqual(expected)',
        '',
        '- Expected  - 1',
        '+ Received  + 1',
        '',
        '  {',
        '    "a": 1,',
        '    "b": [',
        '      1,',
        '-     3,',
        '+     2,',
        '    ],',
        '  }',
      ].join('\n')
    );
  });

  it('reject wrong received values with a matcher error', () => {
    expect(failure(() => expect('1').toBeGreaterThan(0))).toMatch('Matcher error: received value must be a number');
    expect(failure(() => expect(1).toThrow())).toMatch('Matcher error: received value must be a function');
    expect(failure(() => expect(1).toHaveBeenCalled())).toMatch('must be a mock or spy function');
  });

  it('prepend the custom message', () => {
    expect(failure(() => expect(1, 'the count').toBe(2))).toMatch(/^the count\n\n/);
  });
});

describe('promises', () => {
  it('resolves and rejects', async () => {
    await expect(Promise.resolve(3)).resolves.toBe(3);
    await expect(Promise.reject(new Error('no'))).rejects.toThrow('no');
    await expect(async () => {
      throw new Error('async fn');
    }).rejects.toThrow('async fn');
  });

  it('fails when the promise settles the other way', async () => {
    await expect(expect(Promise.resolve(1)).rejects.toBe(1)).rejects.toThrow(
      'Received promise resolved instead of rejected'
    );
  });
});

describe('expect.extend', () => {
  expect.extend({
    toBeEven(received) {
      return { pass: received % 2 === 0, message: () => `expected ${received} to be even` };
    },
  });

  it('adds matchers, negated and asymmetric forms', () => {
    expect(2).toBeEven();
    expect(3).not.toBeEven();
    expect({ n: 4 }).toEqual({ n: expect.toBeEven() });
    expect(failure(() => expect(3).toBeEven())).toBe('expected 3 to be even');
  });
});

describe('expect.poll', () => {
  it('retries until the assertion passes', async () => {
    let count = 0;
    await expect.poll(() => (count += 1), { interval: 1 }).toBe(3); // eslint-disable-line no-return-assign
  });
});

describe('the shape of expect()', () => {
  it('has the matchers, .not, .resolves and .rejects as own properties, as Jest', () => {
    const assertion = expect(1);
    expect(Object.keys(assertion)).toEqual(expect.arrayContaining(['toBe', 'toEqual', 'not', 'resolves', 'rejects']));
    // Libraries that wrap expect copy it (langsmith/jest, jest-chain).
    const copy = { ...assertion };
    copy.toBe(1);
    copy.not.toBe(2);
    expect(Object.keys(copy.rejects.not)).toContain('toThrow');
  });

  it('counts only a resolved Error as thrown with .resolves, as Jest', async () => {
    await expect(Promise.resolve('value')).resolves.not.toThrow();
    await expect(Promise.resolve(new Error('resolved error'))).resolves.toThrow('resolved error');
    await expect(Promise.reject(new Error('rejected'))).rejects.toThrow('rejected');
  });
});

describe('chai assertions', () => {
  it('reads the chains of chai, which vitest carries', () => {
    // Chai asserts when the property is read.
    /* eslint-disable no-unused-expressions */
    expect(true).to.be.true;
    expect(false).to.be.false;
    /* eslint-enable no-unused-expressions */
    expect(1).to.equal(1);
    expect(1).to.eq(1);
    expect(1).to.not.equal(2);
    expect({ a: [1] }).to.deep.equal({ a: [1] });
    expect([1, 2]).to.include(2);
    expect([1, 2]).to.not.include(3);
    expect([1, 2]).includes(1);
    expect('abc').to.have.lengthOf(3);
    expect(() => {
      throw new TypeError('bad');
    }).to.throw(TypeError);
    expect(() => {}).to.not.throw();
  });

  it('fails as chai would', () => {
    expect(() => expect(1).to.equal(2)).toThrow('expected 1 to equal 2');
    expect(() => expect(1).not.to.equal(1)).toThrow('expected 1 not to equal 1');
    expect(() => expect([1]).to.include(2)).toThrow('expected [1] to include 2');
  });
});

describe('toHaveProperty', () => {
  it('counts constructor, __proto__ and prototype only as own properties, as vitest', () => {
    expect({}).not.toHaveProperty('constructor');
    expect({ constructor: 'own' }).toHaveProperty('constructor', 'own');
    expect(Object.create({ inherited: 1 })).toHaveProperty('inherited');
  });
});
