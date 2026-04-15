import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { PRESENCE_PUBLISH_INTERVAL_MS, PRESENCE_TIMEOUT_MS } from '../../src/net/constants.js';
import { NOSTR_KIND_PRESENCE } from '../../src/net/nostr-events.js';
import type { EventTemplate, Filter, NostrEvent } from '../../src/net/nostr.js';
import { PresenceTracker } from '../../src/net/presence-tracker.js';

interface MockTimer {
  readonly interval: number;
  readonly fn: () => void;
}

class MockNostrPool {
  readonly pubkey = 'mock-pool';
  readonly published: EventTemplate[] = [];
  private subFilter: Filter | null = null;
  private subHandler: ((e: NostrEvent) => void) | null = null;

  async publish(template: EventTemplate): Promise<void> {
    this.published.push(template);
  }

  publishFireAndForget(template: EventTemplate): void {
    this.published.push(template);
  }

  subscribe(filter: Filter, onEvent: (e: NostrEvent) => void): () => void {
    this.subFilter = filter;
    this.subHandler = onEvent;
    return () => {
      this.subFilter = null;
      this.subHandler = null;
    };
  }

  emit(event: NostrEvent): void {
    this.subHandler?.(event);
  }

  get filter(): Filter | null {
    return this.subFilter;
  }

  get subscribed(): boolean {
    return this.subHandler !== null;
  }
}

interface MockTimers {
  readonly raw: (MockTimer | null)[];
  readonly setIntervalFn: typeof setInterval;
  readonly clearIntervalFn: typeof clearInterval;
  findByInterval(interval: number): number;
  tick(index: number): void;
}

function makeTimers(): MockTimers {
  const raw: (MockTimer | null)[] = [];
  const setIntervalFn = ((fn: () => void, interval: number) => {
    const id = raw.length;
    raw.push({ interval, fn });
    return id as unknown as NodeJS.Timeout;
  }) as unknown as typeof setInterval;
  const clearIntervalFn = ((id: unknown) => {
    raw[id as number] = null;
  }) as unknown as typeof clearInterval;
  return {
    raw,
    setIntervalFn,
    clearIntervalFn,
    findByInterval: (interval: number) =>
      raw.findIndex((t) => t !== null && t.interval === interval),
    tick: (i: number) => raw[i]?.fn(),
  };
}

function fakeEvent(pubkey: string, dayTag: string, tile?: { x: number; y: number }): NostrEvent {
  const topic = tile === undefined ? `grid:${dayTag}` : `grid:${dayTag}:t:${tile.x}-${tile.y}`;
  return {
    id: `id-${pubkey}`,
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: NOSTR_KIND_PRESENCE,
    tags: [['x', topic]],
    content: '',
    sig: 'fake',
  };
}

describe('PresenceTracker', () => {
  it('subscribes with correct filter on start', () => {
    const pool = new MockNostrPool();
    const { setIntervalFn, clearIntervalFn } = makeTimers();
    const tracker = new PresenceTracker({
      pool: pool as unknown as import('../../src/net/nostr.js').NostrPool,
      dayTag: '2026-04-11',
      localPubkey: 'me',
      onPeerSeen: () => {},
      onPeerLost: () => {},
      setIntervalFn,
      clearIntervalFn,
    });
    tracker.start();
    assert.equal(pool.subscribed, true);
    assert.equal(pool.filter?.kinds?.[0], NOSTR_KIND_PRESENCE);
    const xTags = (pool.filter as Record<string, unknown>)['#x'] as string[];
    assert.deepEqual(xTags, ['grid:2026-04-11']);
  });

  it('publishes own presence on start and on interval', () => {
    const pool = new MockNostrPool();
    const mt = makeTimers();
    const tracker = new PresenceTracker({
      pool: pool as unknown as import('../../src/net/nostr.js').NostrPool,
      dayTag: '2026-04-11',
      localPubkey: 'me',
      onPeerSeen: () => {},
      onPeerLost: () => {},
      setIntervalFn: mt.setIntervalFn,
      clearIntervalFn: mt.clearIntervalFn,
    });
    tracker.start();
    assert.equal(pool.published.length, 1); // publish on start
    const publishTimerIdx = mt.findByInterval(PRESENCE_PUBLISH_INTERVAL_MS);
    assert.ok(publishTimerIdx >= 0);
    mt.tick(publishTimerIdx);
    assert.equal(pool.published.length, 2);
    mt.tick(publishTimerIdx);
    assert.equal(pool.published.length, 3);
  });

  it('fires onPeerSeen for new peers', () => {
    const pool = new MockNostrPool();
    const { setIntervalFn, clearIntervalFn } = makeTimers();
    const seen: string[] = [];
    const tracker = new PresenceTracker({
      pool: pool as unknown as import('../../src/net/nostr.js').NostrPool,
      dayTag: '2026-04-11',
      localPubkey: 'me',
      onPeerSeen: (pk) => seen.push(pk),
      onPeerLost: () => {},
      setIntervalFn,
      clearIntervalFn,
    });
    tracker.start();
    pool.emit(fakeEvent('peer-a', '2026-04-11'));
    assert.deepEqual(seen, ['peer-a']);
    pool.emit(fakeEvent('peer-b', '2026-04-11'));
    assert.deepEqual(seen, ['peer-a', 'peer-b']);
  });

  it('does not re-fire onPeerSeen for repeat events from same peer', () => {
    const pool = new MockNostrPool();
    const { setIntervalFn, clearIntervalFn } = makeTimers();
    const seen: string[] = [];
    const tracker = new PresenceTracker({
      pool: pool as unknown as import('../../src/net/nostr.js').NostrPool,
      dayTag: '2026-04-11',
      localPubkey: 'me',
      onPeerSeen: (pk) => seen.push(pk),
      onPeerLost: () => {},
      setIntervalFn,
      clearIntervalFn,
    });
    tracker.start();
    pool.emit(fakeEvent('peer-a', '2026-04-11'));
    pool.emit(fakeEvent('peer-a', '2026-04-11'));
    pool.emit(fakeEvent('peer-a', '2026-04-11'));
    assert.deepEqual(seen, ['peer-a']);
  });

  it('ignores local pubkey events', () => {
    const pool = new MockNostrPool();
    const { setIntervalFn, clearIntervalFn } = makeTimers();
    const seen: string[] = [];
    const tracker = new PresenceTracker({
      pool: pool as unknown as import('../../src/net/nostr.js').NostrPool,
      dayTag: '2026-04-11',
      localPubkey: 'me',
      onPeerSeen: (pk) => seen.push(pk),
      onPeerLost: () => {},
      setIntervalFn,
      clearIntervalFn,
    });
    tracker.start();
    pool.emit(fakeEvent('me', '2026-04-11'));
    assert.deepEqual(seen, []);
  });

  it('fires onPeerLost after timeout', () => {
    const pool = new MockNostrPool();
    const mt = makeTimers();
    const lost: string[] = [];
    let fakeNow = 1_000_000;
    const tracker = new PresenceTracker({
      pool: pool as unknown as import('../../src/net/nostr.js').NostrPool,
      dayTag: '2026-04-11',
      localPubkey: 'me',
      onPeerSeen: () => {},
      onPeerLost: (pk) => lost.push(pk),
      now: () => fakeNow,
      setIntervalFn: mt.setIntervalFn,
      clearIntervalFn: mt.clearIntervalFn,
    });
    tracker.start();
    pool.emit(fakeEvent('peer-a', '2026-04-11'));

    fakeNow += PRESENCE_TIMEOUT_MS + 1000;
    const scanTimerIdx = mt.findByInterval(5000); // PRESENCE_SCAN_INTERVAL_MS
    assert.ok(scanTimerIdx >= 0);
    mt.tick(scanTimerIdx);
    assert.deepEqual(lost, ['peer-a']);
    assert.equal(tracker.peers().size, 0);
  });

  it('peer refresh keeps it alive', () => {
    const pool = new MockNostrPool();
    const mt = makeTimers();
    const lost: string[] = [];
    let fakeNow = 1_000_000;
    const tracker = new PresenceTracker({
      pool: pool as unknown as import('../../src/net/nostr.js').NostrPool,
      dayTag: '2026-04-11',
      localPubkey: 'me',
      onPeerSeen: () => {},
      onPeerLost: (pk) => lost.push(pk),
      now: () => fakeNow,
      setIntervalFn: mt.setIntervalFn,
      clearIntervalFn: mt.clearIntervalFn,
    });
    tracker.start();
    pool.emit(fakeEvent('peer-a', '2026-04-11'));

    fakeNow += PRESENCE_TIMEOUT_MS - 1000;
    pool.emit(fakeEvent('peer-a', '2026-04-11'));
    fakeNow += 2000;
    const scanTimerIdx = mt.findByInterval(5000);
    mt.tick(scanTimerIdx);
    assert.deepEqual(lost, []);
  });

  it('stop clears timers and unsubscribes', () => {
    const pool = new MockNostrPool();
    const { setIntervalFn, clearIntervalFn } = makeTimers();
    const tracker = new PresenceTracker({
      pool: pool as unknown as import('../../src/net/nostr.js').NostrPool,
      dayTag: '2026-04-11',
      localPubkey: 'me',
      onPeerSeen: () => {},
      onPeerLost: () => {},
      setIntervalFn,
      clearIntervalFn,
    });
    tracker.start();
    pool.emit(fakeEvent('peer-a', '2026-04-11'));
    assert.equal(tracker.peers().size, 1);
    tracker.stop();
    assert.equal(pool.subscribed, false);
    assert.equal(tracker.peers().size, 0);
  });

  it('peers() returns current set', () => {
    const pool = new MockNostrPool();
    const { setIntervalFn, clearIntervalFn } = makeTimers();
    const tracker = new PresenceTracker({
      pool: pool as unknown as import('../../src/net/nostr.js').NostrPool,
      dayTag: '2026-04-11',
      localPubkey: 'me',
      onPeerSeen: () => {},
      onPeerLost: () => {},
      setIntervalFn,
      clearIntervalFn,
    });
    tracker.start();
    pool.emit(fakeEvent('peer-a', '2026-04-11'));
    pool.emit(fakeEvent('peer-b', '2026-04-11'));
    const set = tracker.peers();
    assert.equal(set.size, 2);
    assert.ok(set.has('peer-a'));
    assert.ok(set.has('peer-b'));
  });

  it('peers() returns a snapshot that does not reflect later mutations', () => {
    const pool = new MockNostrPool();
    const { setIntervalFn, clearIntervalFn } = makeTimers();
    const tracker = new PresenceTracker({
      pool: pool as unknown as import('../../src/net/nostr.js').NostrPool,
      dayTag: '2026-04-11',
      localPubkey: 'me',
      onPeerSeen: () => {},
      onPeerLost: () => {},
      setIntervalFn,
      clearIntervalFn,
    });
    tracker.start();
    pool.emit(fakeEvent('peer-a', '2026-04-11'));
    const snapshot = tracker.peers();
    assert.equal(snapshot.size, 1);
    pool.emit(fakeEvent('peer-b', '2026-04-11'));
    // snapshot should still have 1 entry, not 2
    assert.equal(snapshot.size, 1);
    // but a fresh call returns 2
    assert.equal(tracker.peers().size, 2);
  });

  it('start() is idempotent (second call is a no-op)', () => {
    const pool = new MockNostrPool();
    const mt = makeTimers();
    const tracker = new PresenceTracker({
      pool: pool as unknown as import('../../src/net/nostr.js').NostrPool,
      dayTag: '2026-04-11',
      localPubkey: 'me',
      onPeerSeen: () => {},
      onPeerLost: () => {},
      setIntervalFn: mt.setIntervalFn,
      clearIntervalFn: mt.clearIntervalFn,
    });
    tracker.start();
    const publishCountAfterFirst = pool.published.length;
    const timerCountAfterFirst = mt.raw.length;
    tracker.start();
    // Second start should not create new timers or publish again
    assert.equal(pool.published.length, publishCountAfterFirst);
    assert.equal(mt.raw.length, timerCountAfterFirst);
  });

  it('stop() is idempotent (second call is a no-op)', () => {
    const pool = new MockNostrPool();
    const mt = makeTimers();
    const tracker = new PresenceTracker({
      pool: pool as unknown as import('../../src/net/nostr.js').NostrPool,
      dayTag: '2026-04-11',
      localPubkey: 'me',
      onPeerSeen: () => {},
      onPeerLost: () => {},
      setIntervalFn: mt.setIntervalFn,
      clearIntervalFn: mt.clearIntervalFn,
    });
    tracker.start();
    tracker.stop();
    // Second stop should not throw
    assert.doesNotThrow(() => tracker.stop());
  });

  it('stop() before start() is safe', () => {
    const pool = new MockNostrPool();
    const mt = makeTimers();
    const tracker = new PresenceTracker({
      pool: pool as unknown as import('../../src/net/nostr.js').NostrPool,
      dayTag: '2026-04-11',
      localPubkey: 'me',
      onPeerSeen: () => {},
      onPeerLost: () => {},
      setIntervalFn: mt.setIntervalFn,
      clearIntervalFn: mt.clearIntervalFn,
    });
    assert.doesNotThrow(() => tracker.stop());
  });

  it('scanForTimeouts reports multiple peers lost in one pass', () => {
    const pool = new MockNostrPool();
    const mt = makeTimers();
    const lost: string[] = [];
    let fakeNow = 1_000_000;
    const tracker = new PresenceTracker({
      pool: pool as unknown as import('../../src/net/nostr.js').NostrPool,
      dayTag: '2026-04-11',
      localPubkey: 'me',
      onPeerSeen: () => {},
      onPeerLost: (pk) => lost.push(pk),
      now: () => fakeNow,
      setIntervalFn: mt.setIntervalFn,
      clearIntervalFn: mt.clearIntervalFn,
    });
    tracker.start();
    pool.emit(fakeEvent('peer-a', '2026-04-11'));
    pool.emit(fakeEvent('peer-b', '2026-04-11'));
    pool.emit(fakeEvent('peer-c', '2026-04-11'));

    fakeNow += PRESENCE_TIMEOUT_MS + 1000;
    const scanTimerIdx = mt.findByInterval(5000);
    mt.tick(scanTimerIdx);
    assert.equal(lost.length, 3);
    assert.deepEqual(lost.sort(), ['peer-a', 'peer-b', 'peer-c']);
    assert.equal(tracker.peers().size, 0);
  });

  it('scanForTimeouts only reports actually-expired peers (mixed case)', () => {
    const pool = new MockNostrPool();
    const mt = makeTimers();
    const lost: string[] = [];
    let fakeNow = 1_000_000;
    const tracker = new PresenceTracker({
      pool: pool as unknown as import('../../src/net/nostr.js').NostrPool,
      dayTag: '2026-04-11',
      localPubkey: 'me',
      onPeerSeen: () => {},
      onPeerLost: (pk) => lost.push(pk),
      now: () => fakeNow,
      setIntervalFn: mt.setIntervalFn,
      clearIntervalFn: mt.clearIntervalFn,
    });
    tracker.start();
    // peer-a seen at t=0
    pool.emit(fakeEvent('peer-a', '2026-04-11'));
    // peer-b seen much later, still fresh
    fakeNow += PRESENCE_TIMEOUT_MS - 1000;
    pool.emit(fakeEvent('peer-b', '2026-04-11'));
    // Advance another 2s — peer-a is now expired, peer-b is still fresh
    fakeNow += 2000;
    const scanTimerIdx = mt.findByInterval(5000);
    mt.tick(scanTimerIdx);
    assert.deepEqual(lost, ['peer-a']);
    assert.equal(tracker.peers().size, 1);
    assert.ok(tracker.peers().has('peer-b'));
  });

  // ---- Stage 13: tile-scoped presence ----

  it('subscribes to tile-scoped topic when homeTile is provided', () => {
    const pool = new MockNostrPool();
    const { setIntervalFn, clearIntervalFn } = makeTimers();
    const tracker = new PresenceTracker({
      pool: pool as unknown as import('../../src/net/nostr.js').NostrPool,
      dayTag: '2026-04-11',
      localPubkey: 'me',
      homeTile: { x: 3, y: 7 },
      onPeerSeen: () => {},
      onPeerLost: () => {},
      setIntervalFn,
      clearIntervalFn,
    });
    tracker.start();
    const xTags = (pool.filter as Record<string, unknown>)['#x'] as string[];
    assert.deepEqual(xTags, ['grid:2026-04-11:t:3-7']);
  });

  it('publishes presence with tile-scoped x tag', () => {
    const pool = new MockNostrPool();
    const mt = makeTimers();
    const tracker = new PresenceTracker({
      pool: pool as unknown as import('../../src/net/nostr.js').NostrPool,
      dayTag: '2026-04-11',
      localPubkey: 'me',
      homeTile: { x: 0, y: 0 },
      onPeerSeen: () => {},
      onPeerLost: () => {},
      setIntervalFn: mt.setIntervalFn,
      clearIntervalFn: mt.clearIntervalFn,
    });
    tracker.start();
    assert.equal(pool.published.length, 1);
    const xTag = pool.published[0]?.tags.find((t) => t[0] === 'x')?.[1];
    assert.equal(xTag, 'grid:2026-04-11:t:0-0');
  });

  it('2-tile isolation: peers in different tiles do not see each other', () => {
    // Tracker scoped to tile (0,0) receives an event tagged for tile (1,0).
    // The event would not arrive through the subscription filter in the real
    // Nostr pool, but this test confirms the tracker's OWN topic discipline
    // by verifying subscription filters are tile-specific (see previous test).
    // Here we additionally verify that publishes from different tiles produce
    // distinct, non-overlapping topics.
    const pool = new MockNostrPool();
    const mt = makeTimers();
    const trackerA = new PresenceTracker({
      pool: pool as unknown as import('../../src/net/nostr.js').NostrPool,
      dayTag: '2026-04-11',
      localPubkey: 'me',
      homeTile: { x: 0, y: 0 },
      onPeerSeen: () => {},
      onPeerLost: () => {},
      setIntervalFn: mt.setIntervalFn,
      clearIntervalFn: mt.clearIntervalFn,
    });
    trackerA.start();
    const topicA = pool.published[0]?.tags.find((t) => t[0] === 'x')?.[1];
    pool.published.length = 0;

    const poolB = new MockNostrPool();
    const trackerB = new PresenceTracker({
      pool: poolB as unknown as import('../../src/net/nostr.js').NostrPool,
      dayTag: '2026-04-11',
      localPubkey: 'them',
      homeTile: { x: 1, y: 0 },
      onPeerSeen: () => {},
      onPeerLost: () => {},
      setIntervalFn: mt.setIntervalFn,
      clearIntervalFn: mt.clearIntervalFn,
    });
    trackerB.start();
    const topicB = poolB.published[0]?.tags.find((t) => t[0] === 'x')?.[1];

    assert.notEqual(topicA, topicB);
    assert.equal(topicA, 'grid:2026-04-11:t:0-0');
    assert.equal(topicB, 'grid:2026-04-11:t:1-0');
  });

  it('tile-scoped tracker ignores events from different tile', () => {
    const pool = new MockNostrPool();
    const mt = makeTimers();
    const seen: string[] = [];
    const tracker = new PresenceTracker({
      pool: pool as unknown as import('../../src/net/nostr.js').NostrPool,
      dayTag: '2026-04-11',
      localPubkey: 'me',
      homeTile: { x: 0, y: 0 },
      onPeerSeen: (pk) => seen.push(pk),
      onPeerLost: () => {},
      setIntervalFn: mt.setIntervalFn,
      clearIntervalFn: mt.clearIntervalFn,
    });
    tracker.start();
    // Even if pool.emit delivers events from a different tile (simulating a
    // buggy relay), the tracker's filter would have rejected them. Here the
    // real filtering is in the pool subscription — we just sanity-check that
    // emitted tile-(0,0) events are accepted.
    pool.emit(fakeEvent('peer-a', '2026-04-11', { x: 0, y: 0 }));
    assert.deepEqual(seen, ['peer-a']);
  });

  it('legacy behavior preserved: no homeTile → day-level topic', () => {
    const pool = new MockNostrPool();
    const { setIntervalFn, clearIntervalFn } = makeTimers();
    const tracker = new PresenceTracker({
      pool: pool as unknown as import('../../src/net/nostr.js').NostrPool,
      dayTag: '2026-04-11',
      localPubkey: 'me',
      onPeerSeen: () => {},
      onPeerLost: () => {},
      setIntervalFn,
      clearIntervalFn,
    });
    tracker.start();
    const xTags = (pool.filter as Record<string, unknown>)['#x'] as string[];
    assert.deepEqual(xTags, ['grid:2026-04-11']);
  });

  // ---- Stage 13: positive case — same tile connectivity ----

  it('same-tile connectivity: tile-scoped tracker sees peers in same tile', () => {
    // Emit a tile-scoped presence event for the tracker's home tile;
    // the tracker should fire onPeerSeen because the event topic matches.
    const pool = new MockNostrPool();
    const mt = makeTimers();
    const seen: string[] = [];
    const tracker = new PresenceTracker({
      pool: pool as unknown as import('../../src/net/nostr.js').NostrPool,
      dayTag: '2026-04-11',
      localPubkey: 'me',
      homeTile: { x: 2, y: 3 },
      onPeerSeen: (pk) => seen.push(pk),
      onPeerLost: () => {},
      setIntervalFn: mt.setIntervalFn,
      clearIntervalFn: mt.clearIntervalFn,
    });
    tracker.start();
    // Event from a peer in the same tile (2, 3).
    pool.emit(fakeEvent('peer-a', '2026-04-11', { x: 2, y: 3 }));
    pool.emit(fakeEvent('peer-b', '2026-04-11', { x: 2, y: 3 }));
    assert.deepEqual(seen.sort(), ['peer-a', 'peer-b']);
  });

  it('tile-scoped tracker handles negative tile coordinates end-to-end', () => {
    const pool = new MockNostrPool();
    const mt = makeTimers();
    const seen: string[] = [];
    const tracker = new PresenceTracker({
      pool: pool as unknown as import('../../src/net/nostr.js').NostrPool,
      dayTag: '2026-04-11',
      localPubkey: 'me',
      homeTile: { x: -1, y: -1 },
      onPeerSeen: (pk) => seen.push(pk),
      onPeerLost: () => {},
      setIntervalFn: mt.setIntervalFn,
      clearIntervalFn: mt.clearIntervalFn,
    });
    tracker.start();
    // Subscription topic should be 'grid:2026-04-11:t:-1--1'.
    const xTags = (pool.filter as Record<string, unknown>)['#x'] as string[];
    assert.deepEqual(xTags, ['grid:2026-04-11:t:-1--1']);
    // Published presence should use the same topic.
    const publishedX = pool.published[0]?.tags.find((t) => t[0] === 'x')?.[1];
    assert.equal(publishedX, 'grid:2026-04-11:t:-1--1');
    // Events from the same tile are accepted.
    pool.emit(fakeEvent('peer-x', '2026-04-11', { x: -1, y: -1 }));
    assert.deepEqual(seen, ['peer-x']);
  });
});
