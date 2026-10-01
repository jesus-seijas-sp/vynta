const state = require('../state');
const { matcherError, printDiffOrStringify, printReceived } = require('../expect/context');
const { subsetEquals } = require('../expect/equals');
const { userFrames, samePath } = require('../utils/stack');
const { stripIndentation } = require('./inline-snapshots');
const { serializers } = require('./serializers');
const { SnapshotState } = require('./snapshot-state');

function snapshotState() {
  const { file, config } = state;
  file.snapshot ??= new SnapshotState(file.path, {
    update: Boolean(config.update),
    ci: config.ci ?? Boolean(process.env.CI),
    serializers,
  });
  return file.snapshot;
}

function checkUsage(ctx, name) {
  if (ctx.isNot) {
    throw matcherError(ctx.hint(name, ''), 'Snapshot matchers cannot be used with not');
  }
  if (!state.test) {
    throw new Error(`${name}() can only be used inside a test`);
  }
  return state.test;
}

// Received with the values the property matchers cover replaced by the matchers, so snapshots print Any<Number>
// instead of values that change on every run.
function withProperties(received, properties) {
  if (!properties || typeof properties !== 'object' || typeof properties.asymmetricMatch === 'function') {
    return properties ?? received;
  }
  if (Array.isArray(received)) {
    return received.map((item, i) => (i in properties ? withProperties(item, properties[i]) : item));
  }
  const result = { ...received };
  Object.keys(properties).forEach((key) => {
    result[key] = withProperties(received?.[key], properties[key]);
  });
  return result;
}

function propertiesFailure(ctx, name, received, properties) {
  return {
    pass: false,
    message: () =>
      `${ctx.hint(name, 'properties')}\n\nThe received value does not match the property matchers\n\n${printDiffOrStringify(properties, received, 'Expected properties', 'Received value')}`,
  };
}

function missingMessage(key) {
  return `New snapshot was not written. The update flag must be explicitly passed to write a new snapshot.\n\nThis is likely because this test is run in a continuous integration (CI) environment in which snapshots are not written by default.\n\nSnapshot name: \`${key}\``;
}

function snapshotResult(ctx, name, key, { pass, expected, missing }, serialized) {
  return {
    pass,
    message: () => {
      if (missing) {
        return `${ctx.hint(name, '')}\n\n${missingMessage(key)}`;
      }
      return `${ctx.hint(name, key ? 'hint' : '')}\n\nSnapshot name: \`${key}\`\n\n${printDiffOrStringify(expected, serialized, 'Snapshot', 'Received')}`;
    },
  };
}

function matchStored(ctx, name, value, hint) {
  const test = checkUsage(ctx, name);
  const snapshots = snapshotState();
  const counterName = `${test.fullName}:${hint ?? ''}`;
  const count = (test.snapshotCounts.get(counterName) ?? 0) + 1;
  test.snapshotCounts.set(counterName, count);
  const key = snapshots.keyFor(test.titlePath, hint, count);
  const serialized = snapshots.serialize(value);
  return snapshotResult(ctx, name, key, snapshots.match(key, serialized), serialized);
}

function toMatchSnapshot(received, propertiesOrHint, maybeHint) {
  const [properties, hint] =
    typeof propertiesOrHint === 'string' ? [undefined, propertiesOrHint] : [propertiesOrHint, maybeHint];
  if (properties && !subsetEquals(received, properties)) {
    checkUsage(this, 'toMatchSnapshot');
    return propertiesFailure(this, 'toMatchSnapshot', received, properties);
  }
  return matchStored(this, 'toMatchSnapshot', withProperties(received, properties), hint);
}

// Where in the test file the matcher was called, for rewriting the source.
function callLocation(matcher) {
  const frame = userFrames(new Error().stack).find(({ file }) => samePath(file, state.file.path));
  if (!frame) {
    throw new Error(`${matcher}() must be called in the test file itself`);
  }
  return { line: frame.line, column: frame.column, matcher };
}

function matchInline(ctx, name, value, snapshot, hasProperties) {
  checkUsage(ctx, name);
  const snapshots = snapshotState();
  const serialized = snapshots.serialize(value);
  const expected = snapshot === undefined ? undefined : stripIndentation(snapshot);
  const location = { ...callLocation(name), hasProperties };
  return snapshotResult(ctx, name, '', snapshots.matchInline(expected, serialized, location), serialized);
}

function toMatchInlineSnapshot(received, propertiesOrSnapshot, maybeSnapshot) {
  const hasProperties = typeof propertiesOrSnapshot === 'object' && propertiesOrSnapshot !== null;
  const [properties, snapshot] = hasProperties
    ? [propertiesOrSnapshot, maybeSnapshot]
    : [undefined, propertiesOrSnapshot];
  if (properties && !subsetEquals(received, properties)) {
    checkUsage(this, 'toMatchInlineSnapshot');
    return propertiesFailure(this, 'toMatchInlineSnapshot', received, properties);
  }
  return matchInline(this, 'toMatchInlineSnapshot', withProperties(received, properties), snapshot, hasProperties);
}

// The thrown error as snapshotted: its message for Jest, the whole error for vitest.
function thrownValue(ctx, name, received) {
  let error;
  if (ctx.promise) {
    error = received;
  } else if (typeof received === 'function') {
    try {
      received();
    } catch (thrown) {
      error = thrown;
    }
  } else {
    throw matcherError(ctx.hint(name, ''), 'received value must be a function', `Received: ${printReceived(received)}`);
  }
  if (error === undefined) {
    return { thrown: false };
  }
  return { thrown: true, value: snapshotState().style === 'vitest' ? error : error?.message };
}

const notThrown = (ctx, name) => ({
  pass: false,
  message: () => `${ctx.hint(name, '')}\n\nReceived function did not throw`,
});

function toThrowErrorMatchingSnapshot(received, hint) {
  checkUsage(this, 'toThrowErrorMatchingSnapshot');
  const { thrown, value } = thrownValue(this, 'toThrowErrorMatchingSnapshot', received);
  return thrown
    ? matchStored(this, 'toThrowErrorMatchingSnapshot', value, hint)
    : notThrown(this, 'toThrowErrorMatchingSnapshot');
}

function toThrowErrorMatchingInlineSnapshot(received, snapshot) {
  checkUsage(this, 'toThrowErrorMatchingInlineSnapshot');
  const { thrown, value } = thrownValue(this, 'toThrowErrorMatchingInlineSnapshot', received);
  if (!thrown) {
    return notThrown(this, 'toThrowErrorMatchingInlineSnapshot');
  }
  return matchInline(this, 'toThrowErrorMatchingInlineSnapshot', value, snapshot, false);
}

module.exports = {
  toMatchSnapshot,
  toMatchInlineSnapshot,
  toThrowErrorMatchingSnapshot,
  toThrowErrorMatchingInlineSnapshot,
};
