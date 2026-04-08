import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { EvictionTracker, quorum } from '../../src/net/evict.js';
import type { EvictMsg } from '../../src/net/messages.js';

const mk = (from: string, target: string): EvictMsg => ({
  v: 1,
  t: 'EVICT',
  from,
  target,
  reason: 'hash_mismatch',
  tick: 30,
});

describe('quorum', () => {
  it('matches the spec table', () => {
    // remaining = total - 1 (target excluded)
    assert.equal(quorum(1), 1); // 1 of 1 — only one other peer
    assert.equal(quorum(2), 2); // 2 of 2 — both other peers
    assert.equal(quorum(3), 2); // 2 of 3
    assert.equal(quorum(4), 3); // 3 of 4
    assert.equal(quorum(5), 3); // 3 of 5
  });
});

describe('EvictionTracker', () => {
  it('does not evict on a single vote in a 3-peer mesh', () => {
    const t = new EvictionTracker();
    assert.equal(t.record(mk('a', 'c'), 3), null);
    assert.equal(t.isEvicted('c'), false);
  });

  it('evicts when quorum is reached (2 of 2 remaining)', () => {
    const t = new EvictionTracker();
    assert.equal(t.record(mk('a', 'c'), 3), null);
    const d = t.record(mk('b', 'c'), 3);
    assert.ok(d);
    assert.equal(d.target, 'c');
    assert.equal(d.reason, 'hash_mismatch');
    assert.deepEqual([...d.voters].sort(), ['a', 'b']);
    assert.equal(t.isEvicted('c'), true);
  });

  it('ignores duplicate votes from the same voter', () => {
    const t = new EvictionTracker();
    assert.equal(t.record(mk('a', 'c'), 3), null);
    assert.equal(t.record(mk('a', 'c'), 3), null);
  });

  it('ignores self-votes', () => {
    const t = new EvictionTracker();
    assert.equal(t.record(mk('c', 'c'), 3), null);
  });

  it('does not double-evict', () => {
    const t = new EvictionTracker();
    t.record(mk('a', 'c'), 3);
    t.record(mk('b', 'c'), 3);
    assert.equal(t.record(mk('d', 'c'), 4), null);
  });
});
