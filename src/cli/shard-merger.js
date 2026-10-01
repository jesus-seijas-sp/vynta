const SNAPSHOT_COUNTS = ['added', 'updated', 'matched', 'failed', 'obsolete'];

function mergeSnapshots(parts) {
  const snapshots = parts.map((part) => part.snapshot).filter(Boolean);
  if (snapshots.length === 0) {
    return null;
  }
  return Object.fromEntries(
    SNAPSHOT_COUNTS.map((key) => [key, snapshots.reduce((sum, snapshot) => sum + (snapshot[key] ?? 0), 0)])
  );
}

// One result for a file from the results of its shards: the tests back in their order in the file. duration is the
// time the file took (its longest shard); work, what running it whole would take, for the next schedule.
function merge(parts) {
  return {
    path: parts[0].path,
    duration: Math.max(...parts.map((part) => part.duration)),
    work: parts.reduce((sum, part) => sum + part.duration, 0),
    collectDuration: Math.max(...parts.map((part) => part.collectDuration ?? 0)),
    tests: parts.flatMap((part) => part.tests).sort((a, b) => a.index - b.index),
    errors: parts.flatMap((part) => part.errors),
    console: parts.flatMap((part) => part.console),
    snapshot: mergeSnapshots(parts),
    shards: parts.length,
  };
}

// Passes the results of whole files on, and holds the shards of split files until all of them arrived.
class ShardMerger {
  constructor(onResult) {
    this.onResult = onResult;
    this.pending = new Map();
  }

  add(result) {
    if (!result.shard) {
      this.onResult(result);
      return;
    }
    const parts = this.pending.get(result.path) ?? [];
    parts.push(result);
    if (parts.length < result.shard.count) {
      this.pending.set(result.path, parts);
      return;
    }
    this.pending.delete(result.path);
    this.onResult(merge(parts));
  }

  // Files whose shards did not all arrive (the run stopped early, with --bail): reported with what they have.
  flush() {
    this.pending.forEach((parts) => this.onResult(merge(parts)));
    this.pending.clear();
  }
}

module.exports = { ShardMerger };
