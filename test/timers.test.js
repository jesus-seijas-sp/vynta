describe('fake timers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs timeouts when the time advances', () => {
    const fn = vi.fn();
    setTimeout(fn, 100, 'arg');
    vi.advanceTimersByTime(99);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledWith('arg');
  });

  it('runs intervals every period and clears them', () => {
    const fn = vi.fn();
    const id = setInterval(fn, 10);
    vi.advanceTimersByTime(35);
    expect(fn).toHaveBeenCalledTimes(3);
    clearInterval(id);
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('runs timers in order of time, then of creation', () => {
    const order = [];
    setTimeout(() => order.push('b'), 20);
    setTimeout(() => order.push('a1'), 10);
    setTimeout(() => order.push('a2'), 10);
    setImmediate(() => order.push('now'));
    vi.runAllTimers();
    expect(order).toEqual(['now', 'a1', 'a2', 'b']);
  });

  it('runs only the pending timers', () => {
    const fn = vi.fn(() => setTimeout(fn, 10));
    setTimeout(fn, 10);
    vi.runOnlyPendingTimers();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('detects infinite loops', () => {
    const again = () => setTimeout(again, 1);
    again();
    expect(() => vi.runAllTimers()).toThrow('Aborting after running 100000 timers');
  });

  it('fakes Date and performance.now', () => {
    vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
    expect(new Date().toISOString()).toBe('2030-01-01T00:00:00.000Z');
    expect(Date.now()).toBe(Date.UTC(2030, 0, 1));
    const start = performance.now();
    vi.advanceTimersByTime(250);
    expect(performance.now() - start).toBe(250);
    expect(new Date(0).getTime()).toBe(0);
    expect(new Date() instanceof Date).toBe(true);
  });

  it('lets promises settle between timers with the async variants', async () => {
    const order = [];
    setTimeout(async () => {
      order.push('timer 1');
      await Promise.resolve();
      order.push('after await');
      setTimeout(() => order.push('timer 2'), 10);
    }, 10);
    await vi.advanceTimersByTimeAsync(20);
    expect(order).toEqual(['timer 1', 'after await', 'timer 2']);
  });
});

describe('real timers', () => {
  it('are back after useRealTimers, and the runner timeouts never use fake ones', async () => {
    vi.useFakeTimers();
    vi.useRealTimers();
    await new Promise((resolve) => {
      setTimeout(resolve, 1);
    });
    expect(vi.isFakeTimers()).toBe(false);
  });
});
