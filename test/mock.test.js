describe('vi.fn', () => {
  it('records calls, results, contexts and instances', () => {
    const fn = vi.fn((a, b) => a + b);
    expect(fn(1, 2)).toBe(3);
    const context = { fn };
    context.fn(3, 4);
    expect(fn.mock.calls).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(fn.mock.results).toEqual([
      { type: 'return', value: 3 },
      { type: 'return', value: 7 },
    ]);
    expect(fn.mock.contexts[1]).toBe(context);
    expect(fn.mock.instances[1]).toBe(context);
    expect(fn.mock.lastCall).toEqual([3, 4]);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith(3, 4);
    expect(fn).toHaveBeenNthCalledWith(1, 1, 2);
    expect(fn).toHaveReturnedWith(7);
  });

  it('records thrown errors', () => {
    const fn = vi.fn(() => {
      throw new Error('x');
    });
    expect(() => fn()).toThrow('x');
    expect(fn.mock.results[0].type).toBe('throw');
  });

  it('changes implementations, once or for good', async () => {
    const fn = vi.fn().mockReturnValue('default').mockReturnValueOnce('first');
    expect(fn()).toBe('first');
    expect(fn()).toBe('default');
    fn.mockImplementation(() => 'impl');
    expect(fn()).toBe('impl');
    fn.mockResolvedValueOnce('async');
    await expect(fn()).resolves.toBe('async');
    fn.mockRejectedValueOnce(new Error('rejected'));
    await expect(fn()).rejects.toThrow('rejected');
    expect(
      fn.withImplementation(
        () => 'temporary',
        () => fn()
      )
    ).toBe(fn);
    expect(fn()).toBe('impl');
  });

  it('works as a constructor', () => {
    const Ctor = vi.fn(function Person(name) {
      this.name = name;
    });
    const person = new Ctor('ann');
    expect(person.name).toBe('ann');
    expect(Ctor.mock.instances[0]).toBe(person);
    const Arrow = vi.fn(() => ({ built: true }));
    expect(new Arrow()).toEqual({ built: true });
  });

  it('clears and resets', () => {
    const fn = vi.fn(() => 1);
    fn();
    fn.mockClear();
    expect(fn).not.toHaveBeenCalled();
    fn.mockReturnValue(2);
    fn.mockReset();
    expect(fn()).toBe(1);
  });

  it('is a jest.fn too', () => {
    expect(jest.fn).toBe(vi.fn);
    expect(vi.isMockFunction(jest.fn())).toBe(true);
  });
});

describe('spyOn', () => {
  it('spies on a plain value as a getter, as vitest does, and puts the value back', () => {
    const client = { producer: null };
    const spy = vi.spyOn(client, 'producer', 'get').mockReturnValue('mocked');
    expect(client.producer).toBe('mocked');
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
    expect(Object.getOwnPropertyDescriptor(client, 'producer')).toEqual({
      value: null,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  });

  it('is also the global vitest, as in vitest with globals', () => {
    expect(globalThis.vitest).toBe(vi);
  });

  it('calls through and restores', () => {
    const calculator = { add: (a, b) => a + b };
    const spy = vi.spyOn(calculator, 'add');
    expect(calculator.add(1, 1)).toBe(2);
    expect(spy).toHaveBeenCalledWith(1, 1);
    spy.mockReturnValue(10);
    expect(calculator.add(1, 1)).toBe(10);
    spy.mockRestore();
    expect(calculator.add(1, 1)).toBe(2);
    expect(vi.isMockFunction(calculator.add)).toBe(false);
  });

  it('spies on prototype methods and restores them by removing the own property', () => {
    class Greeter {
      constructor() {
        this.greeting = 'hi';
      }

      greet() {
        return this.greeting;
      }
    }
    const greeter = new Greeter();
    const spy = vi.spyOn(greeter, 'greet').mockReturnValue('mocked');
    expect(greeter.greet()).toBe('mocked');
    spy.mockRestore();
    expect(Object.hasOwn(greeter, 'greet')).toBe(false);
    expect(greeter.greet()).toBe('hi');
  });

  it('spies on getters', () => {
    const obj = {
      get value() {
        return 1;
      },
    };
    const spy = vi.spyOn(obj, 'value', 'get').mockReturnValue(5);
    expect(obj.value).toBe(5);
    expect(spy).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
    expect(obj.value).toBe(1);
  });

  it('throws on missing properties and values that are not functions', () => {
    expect(() => vi.spyOn({}, 'nope')).toThrow('nope property does not exist');
    expect(() => vi.spyOn({ a: 1 }, 'a')).toThrow('because it is not a function');
  });
});

describe('stubs', () => {
  it('stubs globals and environment variables', () => {
    vi.stubGlobal('__vyntraStub', 1);
    vi.stubEnv('VYNTRA_STUB', 'yes');
    expect(globalThis.__vyntraStub).toBe(1); // eslint-disable-line no-underscore-dangle
    expect(process.env.VYNTRA_STUB).toBe('yes');
    vi.unstubAllGlobals().unstubAllEnvs();
    expect('__vyntraStub' in globalThis).toBe(false);
    expect(process.env.VYNTRA_STUB).toBeUndefined();
  });
});
