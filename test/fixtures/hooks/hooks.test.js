const log = [];

beforeAll(() => log.push('root beforeAll'));
afterAll(() => log.push('root afterAll'));
beforeEach(() => log.push('root beforeEach'));
afterEach(() => log.push('root afterEach'));

describe('outer', () => {
  beforeAll(() => log.push('outer beforeAll'));
  afterAll(() => log.push('outer afterAll'));
  beforeEach(() => {
    log.push('outer beforeEach');
    return () => log.push('outer cleanup');
  });
  afterEach(() => log.push('outer afterEach'));

  it('first', () => {
    log.push('first');
  });

  describe('inner', () => {
    beforeEach(() => log.push('inner beforeEach'));
    it('second', () => {
      log.push('second');
    });
  });
});

describe('failing beforeAll', () => {
  beforeAll(() => {
    throw new Error('beforeAll broke');
  });
  it('is failed by its beforeAll', () => {});
});

describe('order', () => {
  it('is the order of Jest', () => {
    expect(log).toEqual([
      'root beforeAll',
      'outer beforeAll',
      'root beforeEach',
      'outer beforeEach',
      'first',
      'outer afterEach',
      'root afterEach',
      'outer cleanup',
      'root beforeEach',
      'outer beforeEach',
      'inner beforeEach',
      'second',
      'outer afterEach',
      'root afterEach',
      'outer cleanup',
      'outer afterAll',
      'root beforeEach',
    ]);
  });
});
