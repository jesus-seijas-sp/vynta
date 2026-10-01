const { equals, subsetEquals } = require('../src/expect/equals');

class Point {
  constructor(x) {
    this.x = x;
  }
}

describe('equals (toEqual)', () => {
  it.each([
    ['numbers', 1, 1],
    ['NaN', NaN, NaN],
    ['strings', 'a', 'a'],
    ['nested objects', { a: { b: [1, { c: 2 }] } }, { a: { b: [1, { c: 2 }] } }],
    ['undefined properties', { a: 1, b: undefined }, { a: 1 }],
    ['sparse and undefined arrays', [, 1], [undefined, 1]], // eslint-disable-line no-sparse-arrays
    ['dates', new Date(5), new Date(5)],
    ['regexps', /a/gi, /a/gi],
    [
      'maps in any order',
      new Map([
        [1, 'a'],
        [2, 'b'],
      ]),
      new Map([
        [2, 'b'],
        [1, 'a'],
      ]),
    ],
    ['sets in any order', new Set([1, { a: 2 }]), new Set([{ a: 2 }, 1])],
    ['class and plain object', new Point(1), { x: 1 }],
    ['errors by message', new Error('x'), new TypeError('x')],
    ['typed arrays', new Uint8Array([1, 2]), new Uint8Array([1, 2])],
    ['array buffers', new Uint8Array([1, 2]).buffer, new Uint8Array([1, 2]).buffer],
    ['symbol keys', { [Symbol.for('k')]: 1 }, { [Symbol.for('k')]: 1 }],
    ['boxed primitives', Object(1), Object(1)],
  ])('considers equal %s', (name, a, b) => {
    expect(equals(a, b)).toBe(true);
    expect(equals(b, a)).toBe(true);
  });

  it.each([
    ['0 and -0', 0, -0],
    ['number and string', 1, '1'],
    ['primitive and its box', 1, Object(1)],
    ['null and undefined', null, undefined],
    ['arrays of other length', [1], [1, 2]],
    ['objects with other values', { a: 1 }, { a: 2 }],
    ['an object and an array', {}, []],
    ['dates', new Date(1), new Date(2)],
    ['regexps with other flags', /a/g, /a/],
    ['maps', new Map([[1, 'a']]), new Map([[1, 'b']])],
    ['sets', new Set([1]), new Set([2])],
    ['typed arrays', new Uint8Array([1]), new Uint8Array([2])],
    ['functions', () => {}, () => {}],
  ])('considers different %s', (name, a, b) => {
    expect(equals(a, b)).toBe(false);
    expect(equals(b, a)).toBe(false);
  });

  it('handles circular references', () => {
    const a = { name: 'a' };
    a.self = a;
    const b = { name: 'a' };
    b.self = b;
    expect(equals(a, b)).toBe(true);
    const c = { name: 'a', self: { name: 'a' } };
    expect(equals(a, c)).toBe(false);
  });
});

describe('equals (toStrictEqual)', () => {
  it('takes undefined properties, sparseness and classes into account', () => {
    expect(equals({ a: 1, b: undefined }, { a: 1 }, [], true)).toBe(false);
    expect(equals([, 1], [undefined, 1], [], true)).toBe(false); // eslint-disable-line no-sparse-arrays
    expect(equals(new Point(1), { x: 1 }, [], true)).toBe(false);
    expect(equals(Object.create(null), {}, [], true)).toBe(true);
  });
});

describe('asymmetric matchers inside values', () => {
  it('match on either side', () => {
    expect(equals({ id: 5, tags: ['a'] }, { id: expect.any(Number), tags: expect.arrayContaining(['a']) })).toBe(true);
    expect(equals(expect.stringMatching(/^a/), 'abc')).toBe(true);
    expect(equals({ a: expect.anything() }, { a: null })).toBe(false);
  });
});

describe('subsetEquals (toMatchObject)', () => {
  it('matches objects recursively but arrays exactly', () => {
    expect(subsetEquals({ a: { b: 1, c: 2 }, d: 3 }, { a: { b: 1 } })).toBe(true);
    expect(subsetEquals({ list: [{ a: 1, b: 2 }] }, { list: [{ a: 1 }] })).toBe(true);
    expect(subsetEquals({ list: [1, 2] }, { list: [1] })).toBe(false);
    expect(subsetEquals({ a: 1 }, { a: 1, b: undefined })).toBe(false);
  });
});
