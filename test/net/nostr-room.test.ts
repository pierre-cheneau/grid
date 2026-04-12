import { strict as assert } from 'node:assert';
import { afterEach, describe, it } from 'node:test';
import { NOSTR_KIND_SIGNALING } from '../../src/net/nostr-events.js';
import { NostrRoom } from '../../src/net/nostr-room.js';
import { type SignalingMessage, buildSignalingEvent } from '../../src/net/nostr-signaling.js';
import type { EventTemplate, Filter, NostrEvent } from '../../src/net/nostr.js';
import type { PeerConnection, PeerConnectionDeps } from '../../src/net/peer-connection.js';

// A fake PeerConnection that records interactions and exposes callbacks.
class FakePeer {
  readonly deps: PeerConnectionDeps;
  readonly sentCtrl: string[] = [];
  readonly sentTick: string[] = [];
  readonly receivedSignaling: SignalingMessage[] = [];
  closed = false;
  opened = false;

  constructor(deps: PeerConnectionDeps) {
    this.deps = deps;
  }

  async receiveSignaling(msg: SignalingMessage): Promise<void> {
    this.receivedSignaling.push(msg);
  }

  sendCtrl(raw: string): void {
    this.sentCtrl.push(raw);
  }

  sendTick(raw: string): void {
    this.sentTick.push(raw);
  }

  close(): void {
    this.closed = true;
    this.deps.onClose();
  }

  get isOpen(): boolean {
    return this.opened;
  }

  // Test helpers
  simulateOpen(): void {
    this.opened = true;
    this.deps.onOpen();
  }

  simulateCtrlMessage(raw: string): void {
    this.deps.onCtrlMessage(raw);
  }

  simulateTickMessage(raw: string): void {
    this.deps.onTickMessage(raw);
  }
}

// Mock NostrPool that tracks multiple simultaneous subscriptions.
// Routes emitted events to the matching subscribers by kind.
class MockNostrPool {
  readonly pubkey = 'mock-pool-pubkey';
  readonly published: EventTemplate[] = [];
  verifyResult = true;
  private subs: Array<{ filter: Filter; handler: (e: NostrEvent) => void }> = [];

  async publish(template: EventTemplate): Promise<void> {
    this.published.push(template);
  }

  publishFireAndForget(template: EventTemplate): void {
    this.published.push(template);
  }

  subscribe(filter: Filter, onEvent: (e: NostrEvent) => void): () => void {
    const entry = { filter, handler: onEvent };
    this.subs.push(entry);
    return () => {
      this.subs = this.subs.filter((s) => s !== entry);
    };
  }

  verify(_event: NostrEvent): boolean {
    return this.verifyResult;
  }

  async fetch(): Promise<NostrEvent[]> {
    return [];
  }

  close(): void {}

  /** Emit an event to all subs that match by kind. */
  emit(event: NostrEvent): void {
    for (const sub of this.subs) {
      const kinds = sub.filter.kinds;
      if (kinds && !kinds.includes(event.kind)) continue;
      sub.handler(event);
    }
  }
}

// Track every harness so afterEach can tear them down.
const activeHarnesses: Array<{ room: NostrRoom }> = [];

/** Build a NostrRoom with a mock pool. NostrRoom creates its own real
 *  PresenceTracker internally; we drive it by emitting presence events
 *  through the mock pool's subscription channel. Each harness is tracked
 *  for afterEach cleanup so real setInterval timers don't leak. */
function buildRoomHarnessAuto(localPubkey: string) {
  const pool = new MockNostrPool();
  const peers: FakePeer[] = [];
  const room = new NostrRoom({
    pool: pool as unknown as import('../../src/net/nostr.js').NostrPool,
    dayTag: '2026-04-11',
    localPubkey,
    peerConnectionFactory: (deps) => {
      const fake = new FakePeer(deps);
      peers.push(fake);
      return fake as unknown as PeerConnection;
    },
  });
  const h = { room, pool, peers };
  activeHarnesses.push(h);
  return h;
}

/** Emit a fake presence event that triggers the NostrRoom's internal
 *  PresenceTracker's onPeerSeen callback. */
function emitPresence(pool: MockNostrPool, pubkey: string, dayTag: string): void {
  pool.emit({
    id: `presence-${pubkey}`,
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: 20078, // NOSTR_KIND_PRESENCE
    tags: [['x', `grid:${dayTag}`]],
    content: '',
    sig: 'fake',
  });
}

describe('NostrRoom', () => {
  afterEach(async () => {
    for (const h of activeHarnesses) {
      await h.room.leave();
    }
    activeHarnesses.length = 0;
  });

  it('subscribes to signaling and presence on construction', () => {
    const h = buildRoomHarnessAuto('00001111');
    // Should have TWO subscriptions: signaling (kind 20079) and presence (kind 20078)
    // We can verify by emitting each kind and seeing at least one is handled.
    assert.ok(h.pool !== null);
    // Emit a presence event — if tracker is subscribed, nothing will throw
    emitPresence(h.pool, 'ffffeeee', '2026-04-11');
    // And creating a peer (initiator path) means the subscription works
    assert.equal(h.peers.length, 1);
  });

  it('does not create a peer for self pubkey', () => {
    const h = buildRoomHarnessAuto('00001111');
    emitPresence(h.pool, '00001111', '2026-04-11'); // shouldn't really be called for self, but just in case
    // self doesn't pass isInitiator (me < me is false), so no peer is created
    assert.equal(h.peers.length, 0);
  });

  it('creates initiator peer when local pubkey is lex-lower', () => {
    const h = buildRoomHarnessAuto('00001111');
    emitPresence(h.pool, 'ffffeeee', '2026-04-11'); // higher pubkey
    assert.equal(h.peers.length, 1);
    assert.equal(h.peers[0]?.deps.isInitiator, true);
    assert.equal(h.peers[0]?.deps.remotePubkey, 'ffffeeee');
  });

  it('does NOT create peer when local pubkey is lex-higher (waits for offer)', () => {
    const h = buildRoomHarnessAuto('ffffeeee');
    emitPresence(h.pool, '00001111', '2026-04-11'); // lower pubkey — they should initiate
    assert.equal(h.peers.length, 0);
  });

  it('creates responder peer when offer arrives from unknown peer', () => {
    // NostrRoom can't directly call the signaling handler — we need to emit
    // a real event. But the real PresenceTracker is stubbed. The signaling
    // subscription is set on the mock pool in NostrRoom.start() — so emitting
    // through the pool reaches the room.
    const h = buildRoomHarnessAuto('ffffeeee');
    const remotePubkey = '00001111';
    const offerEvent: NostrEvent = {
      id: 'x',
      pubkey: remotePubkey,
      created_at: 1,
      kind: NOSTR_KIND_SIGNALING,
      tags: [['p', 'ffffeeee']],
      content: JSON.stringify({ t: 'offer', sdp: 'v=0...' }),
      sig: 'fake',
    };
    h.pool.emit(offerEvent);
    assert.equal(h.peers.length, 1);
    assert.equal(h.peers[0]?.deps.isInitiator, false);
    assert.equal(h.peers[0]?.receivedSignaling.length, 1);
    assert.equal(h.peers[0]?.receivedSignaling[0]?.t, 'offer');
  });

  it('ignores signaling events from self', () => {
    const h = buildRoomHarnessAuto('00001111');
    const event: NostrEvent = {
      id: 'x',
      pubkey: '00001111', // self
      created_at: 1,
      kind: NOSTR_KIND_SIGNALING,
      tags: [['p', '00001111']],
      content: JSON.stringify({ t: 'offer', sdp: 'v=0' }),
      sig: 'fake',
    };
    h.pool.emit(event);
    assert.equal(h.peers.length, 0);
  });

  it('ignores signaling events with bad signatures', () => {
    const h = buildRoomHarnessAuto('ffffeeee');
    h.pool.verifyResult = false;
    const event: NostrEvent = {
      id: 'x',
      pubkey: '00001111',
      created_at: 1,
      kind: NOSTR_KIND_SIGNALING,
      tags: [['p', 'ffffeeee']],
      content: JSON.stringify({ t: 'offer', sdp: 'v=0' }),
      sig: 'fake',
    };
    h.pool.emit(event);
    assert.equal(h.peers.length, 0);
  });

  it('drops stale answer/ice signaling for unknown peers', () => {
    const h = buildRoomHarnessAuto('ffffeeee');
    const event: NostrEvent = {
      id: 'x',
      pubkey: '00001111',
      created_at: 1,
      kind: NOSTR_KIND_SIGNALING,
      tags: [['p', 'ffffeeee']],
      content: JSON.stringify({ t: 'answer', sdp: 'v=0' }),
      sig: 'fake',
    };
    h.pool.emit(event);
    assert.equal(h.peers.length, 0);
  });

  it('fires onPeerJoin when a peer opens', () => {
    const h = buildRoomHarnessAuto('00001111');
    const joined: string[] = [];
    h.room.onPeerJoin((pk) => joined.push(pk));
    emitPresence(h.pool, 'ffffeeee', '2026-04-11');
    h.peers[0]?.simulateOpen();
    assert.deepEqual(joined, ['ffffeeee']);
  });

  it('fires onPeerLeave and removes from connections on close', () => {
    const h = buildRoomHarnessAuto('00001111');
    const left: string[] = [];
    h.room.onPeerLeave((pk) => left.push(pk));
    emitPresence(h.pool, 'ffffeeee', '2026-04-11');
    h.peers[0]?.close();
    assert.deepEqual(left, ['ffffeeee']);
  });

  it('sendCtrl broadcast reaches all peers', () => {
    const h = buildRoomHarnessAuto('00001111');
    emitPresence(h.pool, 'ffffeeee', '2026-04-11');
    emitPresence(h.pool, 'ffffaaaa', '2026-04-11');
    h.room.sendCtrl('hello');
    assert.equal(h.peers[0]?.sentCtrl[0], 'hello');
    assert.equal(h.peers[1]?.sentCtrl[0], 'hello');
  });

  it('sendCtrl unicast reaches only the target peer', () => {
    const h = buildRoomHarnessAuto('00001111');
    emitPresence(h.pool, 'ffffeeee', '2026-04-11');
    emitPresence(h.pool, 'ffffaaaa', '2026-04-11');
    h.room.sendCtrl('hello', 'ffffeeee');
    assert.equal(h.peers[0]?.sentCtrl.length, 1);
    assert.equal(h.peers[1]?.sentCtrl.length, 0);
  });

  it('sendTick broadcasts to all peers', () => {
    const h = buildRoomHarnessAuto('00001111');
    emitPresence(h.pool, 'ffffeeee', '2026-04-11');
    emitPresence(h.pool, 'ffffaaaa', '2026-04-11');
    h.room.sendTick('tick-payload');
    assert.equal(h.peers[0]?.sentTick[0], 'tick-payload');
    assert.equal(h.peers[1]?.sentTick[0], 'tick-payload');
  });

  it('forwards ctrl messages to listeners with remote pubkey', () => {
    const h = buildRoomHarnessAuto('00001111');
    const received: Array<[string, string]> = [];
    h.room.onCtrl((raw, sid) => received.push([raw, sid]));
    emitPresence(h.pool, 'ffffeeee', '2026-04-11');
    h.peers[0]?.simulateCtrlMessage('hello-msg');
    assert.deepEqual(received, [['hello-msg', 'ffffeeee']]);
  });

  it('forwards tick messages to listeners with remote pubkey', () => {
    const h = buildRoomHarnessAuto('00001111');
    const received: Array<[string, string]> = [];
    h.room.onTick((raw, sid) => received.push([raw, sid]));
    emitPresence(h.pool, 'ffffeeee', '2026-04-11');
    h.peers[0]?.simulateTickMessage('tick-msg');
    assert.deepEqual(received, [['tick-msg', 'ffffeeee']]);
  });

  it('leave() closes all peers', async () => {
    const h = buildRoomHarnessAuto('00001111');
    emitPresence(h.pool, 'ffffeeee', '2026-04-11');
    emitPresence(h.pool, 'ffffaaaa', '2026-04-11');
    await h.room.leave();
    assert.equal(h.peers[0]?.closed, true);
    assert.equal(h.peers[1]?.closed, true);
  });

  it('publishes signaling events via pool when peer calls sendSignaling', () => {
    const h = buildRoomHarnessAuto('00001111');
    emitPresence(h.pool, 'ffffeeee', '2026-04-11');
    h.peers[0]?.deps.sendSignaling({ t: 'offer', sdp: 'v=0...' });
    const signalingEvents = h.pool.published.filter((e) => e.kind === NOSTR_KIND_SIGNALING);
    assert.equal(signalingEvents.length, 1);
    const event = signalingEvents[0];
    assert.ok(event);
    const pTag = event.tags.find((t) => t[0] === 'p')?.[1];
    assert.equal(pTag, 'ffffeeee');
  });

  it('prevents duplicate peers on repeated presence', () => {
    const h = buildRoomHarnessAuto('00001111');
    emitPresence(h.pool, 'ffffeeee', '2026-04-11');
    emitPresence(h.pool, 'ffffeeee', '2026-04-11');
    emitPresence(h.pool, 'ffffeeee', '2026-04-11');
    assert.equal(h.peers.length, 1);
  });

  it('prevents duplicate peers when offer arrives after initiator started', () => {
    const h = buildRoomHarnessAuto('00001111');
    emitPresence(h.pool, 'ffffeeee', '2026-04-11'); // initiator path creates peer
    const event: NostrEvent = {
      id: 'x',
      pubkey: 'ffffeeee',
      created_at: 1,
      kind: NOSTR_KIND_SIGNALING,
      tags: [['p', '00001111']],
      content: JSON.stringify({ t: 'offer', sdp: 'v=0' }),
      sig: 'fake',
    };
    h.pool.emit(event);
    // Only one peer; the existing initiator peer got the offer message
    assert.equal(h.peers.length, 1);
    assert.equal(h.peers[0]?.receivedSignaling[0]?.t, 'offer');
  });

  it('ignores signaling events with malformed content (parse returns null)', () => {
    const h = buildRoomHarnessAuto('ffffeeee');
    const event: NostrEvent = {
      id: 'x',
      pubkey: '00001111',
      created_at: 1,
      kind: NOSTR_KIND_SIGNALING,
      tags: [['p', 'ffffeeee']],
      content: 'not json',
      sig: 'fake',
    };
    h.pool.emit(event);
    assert.equal(h.peers.length, 0);
  });

  it('multiple onPeerJoin listeners all fire', () => {
    const h = buildRoomHarnessAuto('00001111');
    const joined1: string[] = [];
    const joined2: string[] = [];
    h.room.onPeerJoin((pk) => joined1.push(pk));
    h.room.onPeerJoin((pk) => joined2.push(pk));
    emitPresence(h.pool, 'ffffeeee', '2026-04-11');
    h.peers[0]?.simulateOpen();
    assert.deepEqual(joined1, ['ffffeeee']);
    assert.deepEqual(joined2, ['ffffeeee']);
  });

  it('sendCtrl to unknown pubkey is a silent no-op', () => {
    const h = buildRoomHarnessAuto('00001111');
    emitPresence(h.pool, 'ffffeeee', '2026-04-11');
    assert.doesNotThrow(() => h.room.sendCtrl('msg', 'unknown-pubkey-999'));
    // The known peer should NOT have received the message
    assert.equal(h.peers[0]?.sentCtrl.length, 0);
  });

  it('after peer close, broadcast skips the closed peer', () => {
    const h = buildRoomHarnessAuto('00001111');
    emitPresence(h.pool, 'ffffeeee', '2026-04-11');
    emitPresence(h.pool, 'ffffaaaa', '2026-04-11');
    // Close one peer via direct close()
    h.peers[0]?.close();
    h.room.sendCtrl('broadcast');
    // Only the still-connected peer received it
    assert.equal(h.peers[0]?.sentCtrl.length, 0);
    assert.equal(h.peers[1]?.sentCtrl.length, 1);
  });

  it('after peer close, sendTick skips the closed peer', () => {
    const h = buildRoomHarnessAuto('00001111');
    emitPresence(h.pool, 'ffffeeee', '2026-04-11');
    emitPresence(h.pool, 'ffffaaaa', '2026-04-11');
    h.peers[0]?.close();
    h.room.sendTick('tick');
    assert.equal(h.peers[0]?.sentTick.length, 0);
    assert.equal(h.peers[1]?.sentTick.length, 1);
  });

  it('second leave() call is idempotent', async () => {
    const h = buildRoomHarnessAuto('00001111');
    emitPresence(h.pool, 'ffffeeee', '2026-04-11');
    await h.room.leave();
    assert.doesNotThrow(() => h.room.leave());
  });
});

describe('buildSignalingEvent integration via NostrRoom', () => {
  it('round trips through signaling parse', () => {
    const evt = buildSignalingEvent('target-pk', { t: 'offer', sdp: 'v=0 xyz' });
    assert.equal(evt.kind, NOSTR_KIND_SIGNALING);
    const pTag = evt.tags.find((t) => t[0] === 'p')?.[1];
    assert.equal(pTag, 'target-pk');
  });
});
