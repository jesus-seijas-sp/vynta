const version = process.env.SNAPSHOT_VERSION ?? '1';

describe('stored', () => {
  it('matches objects', () => {
    expect({ version, list: [1, 'two', { three: 3 }], map: new Map([['k', true]]) }).toMatchSnapshot();
  });

  it('numbers calls and hints', () => {
    expect('first `quoted` ${value}').toMatchSnapshot();
    expect('second').toMatchSnapshot('named');
    expect({ id: 42, at: new Date(0) }).toMatchSnapshot({ id: expect.any(Number) });
  });

  it('snapshots errors', () => {
    expect(() => {
      throw new Error(`broken ${version}`);
    }).toThrowErrorMatchingSnapshot();
  });
});

describe('inline', () => {
  it('writes inline snapshots', () => {
    expect({ a: 1, b: [version] }).toMatchInlineSnapshot();
    expect('one line').toMatchInlineSnapshot();
  });
});
