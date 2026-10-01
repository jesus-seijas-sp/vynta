describe('group', () => {
  it('not only', () => {});
  it.only('only test', () => {});
});

describe.only('only describe', () => {
  it('runs', () => {});
});

it('top level not only', () => {});
