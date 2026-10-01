const { isClass } = require('../utils/is-class');

// Every mock created while a file runs, for clearAllMocks() and friends. Emptied when the file ends.
const registry = new Set();
// mock -> { original, restore } for the mocks created by spyOn().
const spies = new WeakMap();

let invocationOrder = 0;

const createMockState = () => ({
  calls: [],
  results: [],
  settledResults: [],
  instances: [],
  contexts: [],
  invocationCallOrder: [],
  lastCall: undefined,
});

const isThenable = (value) => typeof value?.then === 'function';

const isObject = (value) => value !== null && (typeof value === 'object' || typeof value === 'function');

// Calls an implementation the way the mock itself was called. With new, as Jest does, the implementation runs on the
// instance the mock was constructed with (so mock.instances sees what it sets); classes can only be constructed.
function callImplementation(impl, self, args, newTarget) {
  if (!newTarget) {
    return impl.apply(self, args);
  }
  if (isClass(impl)) {
    return Reflect.construct(impl, args, newTarget);
  }
  const value = impl.apply(self, args);
  return isObject(value) ? value : self;
}

function trackSettlement(settled, value) {
  if (!isThenable(value)) {
    Object.assign(settled, { type: 'fulfilled', value });
    return;
  }
  value.then(
    (resolved) => Object.assign(settled, { type: 'fulfilled', value: resolved }),
    (rejected) => Object.assign(settled, { type: 'rejected', value: rejected })
  );
}

function fn(implementation) {
  let mockState = createMockState();
  let impl = implementation;
  let onceQueue = [];
  let name;

  function mockFn(...args) {
    mockState.calls.push(args);
    mockState.contexts.push(this);
    // As in Jest and vitest: the receiver of every call, not only of those made with new.
    mockState.instances.push(this);
    invocationOrder += 1;
    mockState.invocationCallOrder.push(invocationOrder);
    mockState.lastCall = args;
    const result = { type: 'incomplete', value: undefined };
    const settled = { type: 'incomplete', value: undefined };
    mockState.results.push(result);
    mockState.settledResults.push(settled);
    const current = onceQueue.length > 0 ? onceQueue.shift() : impl;
    let value = new.target ? this : undefined;
    try {
      if (current) {
        value = callImplementation(current, this, args, new.target);
      }
    } catch (error) {
      Object.assign(result, { type: 'throw', value: error });
      Object.assign(settled, { type: 'rejected', value: error });
      throw error;
    }
    Object.assign(result, { type: 'return', value });
    // A constructed class instance is the instance, not the `this` the mock was called with.
    if (new.target && isObject(value)) {
      mockState.instances[mockState.instances.length - 1] = value;
    }
    trackSettlement(settled, value);
    return value;
  }

  const setImpl = (value) => {
    impl = value;
    return mockFn;
  };
  const addOnce = (value) => {
    onceQueue.push(value);
    return mockFn;
  };

  Object.defineProperty(mockFn, 'mock', { get: () => mockState, configurable: true });
  Object.assign(mockFn, {
    // The flag Jest, pretty-format and other tools use to recognize mocks.
    _isMockFunction: true,
    getMockName: () => name ?? 'vi.fn()',
    mockName: (value) => {
      name = value;
      return mockFn;
    },
    getMockImplementation: () => impl,
    mockClear: () => {
      mockState = createMockState();
      return mockFn;
    },
    mockReset: () => {
      mockState = createMockState();
      onceQueue = [];
      // A reset spy calls the original again, a reset vi.fn(impl) goes back to impl.
      impl = implementation;
      return mockFn;
    },
    mockRestore: () => {
      mockFn.mockReset();
      spies.get(mockFn)?.restore();
      spies.delete(mockFn);
      return mockFn;
    },
    mockImplementation: setImpl,
    mockImplementationOnce: addOnce,
    mockReturnValue: (value) => setImpl(() => value),
    mockReturnValueOnce: (value) => addOnce(() => value),
    mockResolvedValue: (value) => setImpl(() => Promise.resolve(value)),
    mockResolvedValueOnce: (value) => addOnce(() => Promise.resolve(value)),
    mockRejectedValue: (value) => setImpl(() => Promise.reject(value)),
    mockRejectedValueOnce: (value) => addOnce(() => Promise.reject(value)),
    mockReturnThis: () =>
      setImpl(function returnThis() {
        return this;
      }),
    withImplementation: (value, callback) => {
      const previous = impl;
      impl = value;
      const restore = () => {
        impl = previous;
      };
      const result = callback();
      if (isThenable(result)) {
        return result.finally(restore);
      }
      restore();
      return mockFn;
    },
  });
  registry.add(mockFn);
  return mockFn;
}

const isMockFunction = (value) => typeof value === 'function' && value._isMockFunction === true;

const isSpy = (mock) => spies.has(mock);

function registerSpy(mock, original, restore) {
  spies.set(mock, { original, restore });
}

function clearAllMocks() {
  registry.forEach((mock) => mock.mockClear());
}

function resetAllMocks() {
  registry.forEach((mock) => mock.mockReset());
}

function restoreAllMocks() {
  registry.forEach((mock) => {
    if (isSpy(mock)) {
      mock.mockRestore();
    }
  });
}

// When a file ends: spies go back to the originals and the mocks are forgotten.
function releaseMocks() {
  restoreAllMocks();
  registry.clear();
}

module.exports = {
  fn,
  isMockFunction,
  registerSpy,
  clearAllMocks,
  resetAllMocks,
  restoreAllMocks,
  releaseMocks,
};
