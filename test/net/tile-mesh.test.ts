// TileMesh-focused tests.
//
// The NetClient integration tests in client.test.ts validate end-to-end
// convergence over MockRoomNetwork. The tests here exercise TileMesh directly
// to pin down:
//   • the callback contract (Stage 17b's multi-mesh orchestration depends on it)
//   • the validation boundary (rule 5: trust internally, validate at the edge)
//   • reset completeness (the midnight path)
//   • daemon primitives + tick-loop observables
//
// We deliberately avoid re-testing logic that has dedicated unit tests elsewhere:
// HashCheck desync classification (hashCheck.test.ts), EvictionTracker quorum
// maths (evict.test.ts), Lockstep (lockstep.test.ts), protocol parsing
// (protocol.test.ts). Here we assert only that TileMesh plumbs them correctly.

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { MAX_PROTOCOL_FAULTS, SEED_TIMEOUT_MS } from '../../src/net/constants.js';
import type { EvictReason, Message } from '../../src/net/messages.js';
import { encodeMessage, parseMessage } from '../../src/net/protocol.js';
import type { Room } from '../../src/net/room.js';
import { buildStateResponse } from '../../src/net/sync.js';
import { TileMesh, type TileMeshCallbacks } from '../../src/net/tile-mesh.js';
import {
  type Config,
  type GridState,
  type Player,
  type Turn,
  hashState,
  newRng,
} from '../../src/sim/index.js';
import { MockRoomNetwork } from './mock-room.js';

const cfg: Config = { width: 24, height: 24, halfLifeTicks: 60, seed: 0xbeefn, circular: false };

function makePlayer(id: string, x: number, dir: 0 | 1 | 2 | 3, colorSeed: number): Player {
  return {
    id,
    pos: { x, y: 12 },
    dir,
    isAlive: true,
    respawnAtTick: null,
    score: 0,
    colorSeed,
  };
}

function initialState(pids: readonly string[] = ['alice@host', 'bob@host']): GridState {
  const players = new Map<string, Player>();
  const spawnX = [4, 19, 10, 14];
  const dirs: (0 | 1 | 2 | 3)[] = [1, 3, 1, 3];
  pids.forEach((pid, i) => {
    players.set(pid, makePlayer(pid, spawnX[i] ?? 8 + i, dirs[i] ?? 1, 0xa0 + i));
  });
  return {
    tick: 0,
    config: cfg,
    rng: newRng(cfg.seed),
    players,
    cells: new Map(),
  };
}

class FakeClock {
  now = 0;
  tick(ms: number): void {
    this.now += ms;
  }
}

interface CallbackSpy {
  ticks: number;
  tickCalls: Array<{ tick: number; hash: string; stateTick: number }>;
  joins: string[];
  leaves: string[];
  evicts: Array<{ pid: string; reason: EvictReason }>;
  kicked: number;
  readonly cb: TileMeshCallbacks;
}

function makeSpy(): CallbackSpy {
  const spy: CallbackSpy = {
    ticks: 0,
    tickCalls: [],
    joins: [],
    leaves: [],
    evicts: [],
    kicked: 0,
    cb: {
      onTickAdvance: (state, tick, hash) => {
        spy.ticks++;
        spy.tickCalls.push({ tick, hash, stateTick: state.tick });
      },
      onPeerJoin: (pid) => {
        spy.joins.push(pid);
      },
      onPeerLeave: (pid) => {
        spy.leaves.push(pid);
      },
      onEvict: (pid, reason) => {
        spy.evicts.push({ pid, reason });
      },
      onKicked: () => {
        spy.kicked++;
      },
    },
  };
  return spy;
}

function makeMesh(
  net: MockRoomNetwork,
  pid: string,
  colorSeed: number,
  joinedAt: number,
  clock: () => number,
  spy: CallbackSpy,
  statePids: readonly string[] = [pid],
): TileMesh {
  return new TileMesh(
    {
      tile: { x: 0, y: 0 },
      roomKey: 'grid:test',
      identity: { id: pid, colorSeed, joinedAt },
      initialState: initialState(statePids),
    },
    { roomFactory: net.factory(), clock },
    spy.cb,
  );
}

/** A wire-level peer harness attached to a MockRoomNetwork. Lets a test both
 *  inject crafted messages toward the mesh under test and observe what the
 *  mesh broadcasts. Opaque session-id handling is the same as a real peer. */
interface WirePeer {
  readonly room: Room;
  readonly ctrlIn: Array<{ raw: string; msg: Message }>;
  readonly tickIn: Array<{ raw: string; msg: Message }>;
  send(msg: Message, to?: string): void;
  sendCtrl(msg: Message, to?: string): void;
  sendTick(msg: Message): void;
  sendRaw(raw: string, to?: string): void;
  clear(): void;
}

function attachPeer(net: MockRoomNetwork, pid: string): WirePeer {
  const room = net.createRoom(pid);
  const ctrlIn: WirePeer['ctrlIn'] = [];
  const tickIn: WirePeer['tickIn'] = [];
  room.onCtrl((raw) => {
    try {
      ctrlIn.push({ raw, msg: parseMessage(raw) });
    } catch {
      // parse-resilient — we capture the raw regardless.
    }
  });
  room.onTick((raw) => {
    try {
      tickIn.push({ raw, msg: parseMessage(raw) });
    } catch {
      /* ignore */
    }
  });
  return {
    room,
    ctrlIn,
    tickIn,
    send(msg, to) {
      room.sendCtrl(encodeMessage(msg), to);
    },
    sendCtrl(msg, to) {
      room.sendCtrl(encodeMessage(msg), to);
    },
    sendTick(msg) {
      room.sendTick(encodeMessage(msg));
    },
    sendRaw(raw, to) {
      room.sendCtrl(raw, to);
    },
    clear() {
      ctrlIn.length = 0;
      tickIn.length = 0;
    },
  };
}

function peerHelloMsg(pid: string, joinedAt: number, colorSeed = 0xabc): Message {
  return {
    v: 1,
    t: 'HELLO',
    from: pid,
    color: [colorSeed & 0xff, (colorSeed >> 8) & 0xff, (colorSeed >> 16) & 0xff],
    color_seed: colorSeed,
    kind: 'pilot',
    client: 'grid/test',
    joined_at: joinedAt,
  };
}

// ===========================================================================
// Lifecycle
// ===========================================================================

describe('TileMesh lifecycle', () => {
  it('start and stop drive the room connection', async () => {
    const net = new MockRoomNetwork();
    const clock = new FakeClock();
    const spy = makeSpy();
    const mesh = makeMesh(net, 'alice@host', 0xa1, 1000, () => clock.now, spy);

    await mesh.start();
    assert.equal(mesh.isStopped, false);
    assert.equal(mesh.isPaused, true, 'starts paused until a peer arrives or seed timeout');

    await mesh.stop();
    assert.equal(mesh.isStopped, true);
    await mesh.stop();
    assert.equal(mesh.isStopped, true, 'stop is idempotent');
  });

  it('exposes tile identity on the public field', () => {
    const net = new MockRoomNetwork();
    const spy = makeSpy();
    const mesh = new TileMesh(
      {
        tile: { x: 3, y: -2 },
        roomKey: 'grid:test',
        identity: { id: 'alice@host', colorSeed: 1, joinedAt: 1000 },
        initialState: initialState(['alice@host']),
      },
      { roomFactory: net.factory(), clock: () => 0 },
      spy.cb,
    );
    assert.deepEqual(mesh.tile, { x: 3, y: -2 });
  });

  it('broadcasts BYE on stop', async () => {
    const net = new MockRoomNetwork();
    const spy = makeSpy();
    const mesh = makeMesh(net, 'alice@host', 0xa1, 1000, () => 0, spy);
    const watcher = attachPeer(net, 'watcher@host');
    await mesh.start();
    watcher.clear(); // drop the join-time HELLO
    await mesh.stop();
    const bye = watcher.ctrlIn.find((e) => e.msg.t === 'BYE');
    assert.ok(bye, 'BYE was broadcast on stop');
    assert.equal(bye?.msg.from, 'alice@host');
  });

  it('runOnce returns null when not started (no room)', () => {
    const net = new MockRoomNetwork();
    const spy = makeSpy();
    const mesh = makeMesh(net, 'alice@host', 0xa1, 1000, () => 0, spy);
    assert.equal(mesh.runOnce(0), null);
  });

  it('runOnce returns null after stop', async () => {
    const net = new MockRoomNetwork();
    const clock = new FakeClock();
    const spy = makeSpy();
    const mesh = makeMesh(net, 'alice@host', 0xa1, 1000, () => clock.now, spy);
    await mesh.start();
    await mesh.stop();
    assert.equal(mesh.runOnce(clock.now), null);
  });

  it('seed timeout unpauses when no peers arrive', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const net = new MockRoomNetwork();
    const clock = new FakeClock();
    const spy = makeSpy();
    const mesh = makeMesh(net, 'alice@host', 0xa1, 1000, () => clock.now, spy);
    await mesh.start();
    assert.equal(mesh.isPaused, true, 'paused at start');
    t.mock.timers.tick(SEED_TIMEOUT_MS + 1);
    assert.equal(mesh.isPaused, false, 'unpaused after seed timeout');
    await mesh.stop();
  });

  it('first peer HELLO clears the seed timer (junior branch)', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const net = new MockRoomNetwork();
    const clock = new FakeClock();
    const spy = makeSpy();
    const mesh = makeMesh(net, 'alice@host', 0xa1, 1000, () => clock.now, spy);
    await mesh.start();
    // Mallory joined LATER than alice → junior; mesh unpauses immediately.
    const mallory = attachPeer(net, 'mallory@host');
    mallory.sendCtrl(peerHelloMsg('mallory@host', 1500));
    assert.equal(mesh.isPaused, false, 'unpaused by junior peer');
    // Advancing past seed timeout must NOT re-trigger unpause logic.
    t.mock.timers.tick(SEED_TIMEOUT_MS + 1);
    assert.equal(mesh.isPaused, false);
    await mesh.stop();
  });
});

// ===========================================================================
// Callback contract
// ===========================================================================

describe('TileMesh callback contract', () => {
  it('onPeerJoin fires for new HELLO and onPeerLeave fires on transport disconnect', async () => {
    const net = new MockRoomNetwork();
    const spyA = makeSpy();
    const spyB = makeSpy();
    const a = makeMesh(net, 'alice@host', 0xa1, 1000, () => 0, spyA);
    const b = makeMesh(net, 'bob@host', 0xb0, 1001, () => 0, spyB);
    await a.start();
    await b.start();

    assert.deepEqual(spyA.joins, ['bob@host']);
    assert.deepEqual(spyB.joins, ['alice@host']);
    await b.stop();
    assert.deepEqual(spyA.leaves, ['bob@host']);
    await a.stop();
  });

  it('a peer that stops its transport fires onPeerLeave (realistic peer-exit path)', async () => {
    // BYE's ctrl-dispatch is a best-effort soft notice; the authoritative peer
    // removal flows from the transport's leave listener. This regression test
    // pins the transport path since it is the one production relies on.
    const net = new MockRoomNetwork();
    const spy = makeSpy();
    const mesh = makeMesh(net, 'alice@host', 0xa1, 1000, () => 0, spy);
    await mesh.start();
    const peer = attachPeer(net, 'bob@host');
    peer.sendCtrl(peerHelloMsg('bob@host', 1001));
    assert.deepEqual(spy.joins, ['bob@host']);
    await peer.room.leave();
    assert.deepEqual(spy.leaves, ['bob@host']);
    await mesh.stop();
  });

  it('ghost HELLO (own player id) is silently ignored — no onPeerJoin', async () => {
    const net = new MockRoomNetwork();
    const spy = makeSpy();
    const mesh = makeMesh(net, 'alice@host', 0xa1, 1000, () => 0, spy);
    await mesh.start();
    const ghost = attachPeer(net, 'ghost-alice');
    ghost.sendCtrl(peerHelloMsg('alice@host', 999, 0xa1));
    assert.equal(spy.joins.length, 0, 'ghost HELLO ignored');
    // mesh.peers includes self only — no ghost registered.
    assert.equal(mesh.peers.size, 1);
    assert.deepEqual([...mesh.peers], ['alice@host']);
    await mesh.stop();
  });

  it('onTickAdvance delivers (state, tick, hash) that match one another', async () => {
    const net = new MockRoomNetwork();
    const clockA = new FakeClock();
    const clockB = new FakeClock();
    const spyA = makeSpy();
    const spyB = makeSpy();
    const both = ['alice@host', 'bob@host'] as const;
    const a = makeMesh(net, 'alice@host', 0xa1, 1000, () => clockA.now, spyA, both);
    const b = makeMesh(net, 'bob@host', 0xb0, 1001, () => clockB.now, spyB, both);
    await a.start();
    await b.start();

    const drain = (now: number): void => {
      let progress = true;
      while (progress) {
        progress = false;
        if (a.runOnce(now) !== null) progress = true;
        if (b.runOnce(now) !== null) progress = true;
      }
    };
    for (let i = 0; i < 15; i++) {
      drain(clockA.now);
      clockA.tick(110);
      clockB.tick(110);
    }
    drain(clockA.now + 10_000);

    assert.ok(spyA.tickCalls.length > 0, 'onTickAdvance fired');
    assert.equal(spyA.ticks, a.currentState.tick, 'one fire per tick');
    for (const call of spyA.tickCalls) {
      assert.equal(call.tick, call.stateTick, 'tick arg matches state.tick');
      assert.match(call.hash, /^[0-9a-f]+$/, 'hash is hex');
    }
    assert.equal(spyA.tickCalls.at(-1)?.hash, a.stateHash, 'final fire hash == cached hash');

    await a.stop();
    await b.stop();
  });

  it('quorum eviction → onEvict fires (not onPeerLeave), peer removed', async () => {
    // Setup: self + 2 registered peers. With size+1=3 participants, quorum
    // (excluding target) = floor(2/2)+1 = 2. Self casts one; another peer
    // casts one; quorum is reached and onEvict fires for the target.
    const net = new MockRoomNetwork();
    const spy = makeSpy();
    const mesh = makeMesh(net, 'alice@host', 0xa1, 1000, () => 0, spy);
    await mesh.start();
    const mallory = attachPeer(net, 'mallory@host');
    mallory.sendCtrl(peerHelloMsg('mallory@host', 2000));
    const charlie = attachPeer(net, 'charlie@host');
    charlie.sendCtrl(peerHelloMsg('charlie@host', 2001));
    const dave = attachPeer(net, 'dave@host');
    dave.sendCtrl(peerHelloMsg('dave@host', 2002));
    // mesh.peers = {self, mallory, charlie, dave} → size 4.
    assert.equal(mesh.peers.size, 4);
    spy.evicts.length = 0;

    // With registry.size = 3 remote peers, total participants = 4.
    // remaining (excl. target) = 3. quorum(3) = floor(3/2)+1 = 2.
    // Two distinct voters against mallory reach quorum.

    charlie.sendCtrl({
      v: 1,
      t: 'EVICT',
      from: 'charlie@host',
      target: 'mallory@host',
      reason: 'hash_mismatch',
      tick: 30,
    });
    dave.sendCtrl({
      v: 1,
      t: 'EVICT',
      from: 'dave@host',
      target: 'mallory@host',
      reason: 'hash_mismatch',
      tick: 30,
    });

    assert.deepEqual(
      spy.evicts,
      [{ pid: 'mallory@host', reason: 'hash_mismatch' }],
      'onEvict fired once',
    );
    assert.equal(
      spy.leaves.includes('mallory@host'),
      false,
      'onPeerLeave is NOT fired on quorum eviction — onEvict is the only signal',
    );
    assert.equal(mesh.peers.has('mallory@host'), false, 'evicted peer removed from lockstep');
    await mesh.stop();
  });

  it('self-eviction by quorum → onKicked fires, no onEvict for self', async () => {
    const net = new MockRoomNetwork();
    const spy = makeSpy();
    const mesh = makeMesh(net, 'alice@host', 0xa1, 1000, () => 0, spy);
    await mesh.start();
    const bob = attachPeer(net, 'bob@host');
    const carol = attachPeer(net, 'carol@host');
    bob.sendCtrl(peerHelloMsg('bob@host', 2001));
    carol.sendCtrl(peerHelloMsg('carol@host', 2002));
    // mesh.peers = {self, bob, carol} → size 3.
    assert.equal(mesh.peers.size, 3);

    // With registry.size = 2 remote peers, total = 3. remaining (excl. self)
    // = 2. quorum(2) = floor(2/2)+1 = 2. Two distinct voters against self
    // → onKicked.
    bob.sendCtrl({
      v: 1,
      t: 'EVICT',
      from: 'bob@host',
      target: 'alice@host',
      reason: 'hash_mismatch',
      tick: 30,
    });
    carol.sendCtrl({
      v: 1,
      t: 'EVICT',
      from: 'carol@host',
      target: 'alice@host',
      reason: 'hash_mismatch',
      tick: 30,
    });

    assert.equal(spy.kicked, 1, 'onKicked fired once via self-eviction quorum');
    assert.equal(spy.evicts.length, 0, 'onEvict NOT fired for self — onKicked is the signal');
    assert.equal(mesh.isStopped, false, 'owner decides the stop action');
    await mesh.stop();
  });
});

// ===========================================================================
// Validation boundary (rule 5)
// ===========================================================================

describe('TileMesh validation boundary', () => {
  it('rejects INPUT from an unregistered session (no HELLO yet)', async () => {
    const net = new MockRoomNetwork();
    const spy = makeSpy();
    const mesh = makeMesh(net, 'alice@host', 0xa1, 1000, () => 0, spy);
    await mesh.start();
    const rogue = attachPeer(net, 'rogue');
    rogue.sendTick({ v: 1, t: 'INPUT', from: 'rogue@host', tick: 1, i: 'L' as Turn });
    // mesh.peers includes self only; no promotion of unknown sessions.
    assert.equal(mesh.peers.size, 1, 'unknown session does not grant peer membership');
    assert.equal(spy.joins.length, 0);
    await mesh.stop();
  });

  it('rejects INPUT whose `from` disagrees with its registered session', async () => {
    const net = new MockRoomNetwork();
    const spy = makeSpy();
    const mesh = makeMesh(net, 'alice@host', 0xa1, 1000, () => 0, spy);
    await mesh.start();
    const peer = attachPeer(net, 'bob@host');
    peer.sendCtrl(peerHelloMsg('bob@host', 2001));
    assert.deepEqual(spy.joins, ['bob@host']);
    // Same transport session attempts to speak for another player id.
    peer.sendTick({ v: 1, t: 'INPUT', from: 'carol@host', tick: 1, i: 'L' as Turn });
    // No join happened for carol (only bob is a peer).
    assert.equal(mesh.peers.has('carol@host'), false);
    await mesh.stop();
  });

  it('HELLO that reassigns a session to a different player is treated as spoof', async () => {
    const net = new MockRoomNetwork();
    const spy = makeSpy();
    const mesh = makeMesh(net, 'alice@host', 0xa1, 1000, () => 0, spy);
    await mesh.start();
    const peer = attachPeer(net, 'bob@host');
    peer.sendCtrl(peerHelloMsg('bob@host', 2001));
    assert.deepEqual(spy.joins, ['bob@host']);
    // Now the SAME session sends a HELLO claiming a different player id.
    peer.sendCtrl(peerHelloMsg('mallory@host', 2000));
    assert.deepEqual(spy.joins, ['bob@host'], 'spoofed HELLO does not register a second peer');
    assert.equal(mesh.peers.has('mallory@host'), false);
    await mesh.stop();
  });

  it('malformed JSON is caught via ProtocolError and does not crash', async () => {
    const net = new MockRoomNetwork();
    const spy = makeSpy();
    const mesh = makeMesh(net, 'alice@host', 0xa1, 1000, () => 0, spy);
    await mesh.start();
    const peer = attachPeer(net, 'bob@host');
    // Send garbage — not valid JSON at all.
    peer.sendRaw('not valid json{{{');
    peer.sendRaw(JSON.stringify({ not: 'a protocol message' }));
    // Mesh survives; we can still register a legitimate peer afterwards.
    peer.sendCtrl(peerHelloMsg('bob@host', 2001));
    assert.deepEqual(spy.joins, ['bob@host'], 'mesh recovered after malformed frames');
    await mesh.stop();
  });

  it(`${MAX_PROTOCOL_FAULTS} consecutive faults from a registered peer → self casts EVICT`, async () => {
    const net = new MockRoomNetwork();
    const spy = makeSpy();
    const mesh = makeMesh(net, 'alice@host', 0xa1, 1000, () => 0, spy);
    await mesh.start();
    const peer = attachPeer(net, 'bob@host');
    peer.sendCtrl(peerHelloMsg('bob@host', 2001));
    // Watcher peer so we can inspect the broadcast EVICT.
    const watcher = attachPeer(net, 'watcher');
    watcher.clear();

    for (let i = 0; i < MAX_PROTOCOL_FAULTS; i++) {
      peer.sendRaw(`garbage${i}`);
    }
    const evict = watcher.ctrlIn.find((e) => e.msg.t === 'EVICT' && e.msg.target === 'bob@host');
    assert.ok(evict, 'self broadcast EVICT after fault threshold');
    if (evict && evict.msg.t === 'EVICT') {
      assert.equal(evict.msg.from, 'alice@host');
      assert.equal(evict.msg.reason, 'disconnect');
    }
    await mesh.stop();
  });
});

// ===========================================================================
// Reset completeness
// ===========================================================================

describe('TileMesh reset completeness', () => {
  it('reset clears tick, cached hash, chain hash, and keeps the room open', async () => {
    const net = new MockRoomNetwork();
    const clockA = new FakeClock();
    const clockB = new FakeClock();
    const spyA = makeSpy();
    const spyB = makeSpy();
    const both = ['alice@host', 'bob@host'] as const;
    const a = makeMesh(net, 'alice@host', 0xa1, 1000, () => clockA.now, spyA, both);
    const b = makeMesh(net, 'bob@host', 0xb0, 1001, () => clockB.now, spyB, both);
    await a.start();
    await b.start();

    const drain = (now: number): void => {
      let progress = true;
      while (progress) {
        progress = false;
        if (a.runOnce(now) !== null) progress = true;
        if (b.runOnce(now) !== null) progress = true;
      }
    };
    // Run far enough past the first cadence tick (30) to move the chain hash.
    for (let i = 0; i < 40; i++) {
      drain(clockA.now);
      clockA.tick(110);
      clockB.tick(110);
    }
    drain(clockA.now + 10_000);
    assert.ok(a.currentState.tick > 30, 'crossed a cadence tick');
    const chainBefore = a.chainHash;
    assert.notEqual(chainBefore[0], 0x00, 'chain hash advanced from genesis');

    const fresh: GridState = {
      tick: 0,
      config: cfg,
      rng: newRng(cfg.seed),
      players: new Map([['alice@host', makePlayer('alice@host', 4, 1, 0xa1)]]),
      cells: new Map(),
    };
    a.reset(fresh);

    assert.equal(a.currentState.tick, 0);
    assert.equal(a.stateHash, '', 'cached hash cleared');
    // Genesis hash is a specific constant — just assert it changed BACK to a
    // vector that differs from the pre-reset one.
    assert.notDeepEqual(Array.from(a.chainHash), Array.from(chainBefore), 'chain hash was reset');
    assert.equal(a.isStopped, false, 'room stays open');
    await a.stop();
    await b.stop();
  });

  it('reset clears pending STATE_RESPONSE queue (observable via outbound drain)', async () => {
    const net = new MockRoomNetwork();
    const spy = makeSpy();
    const mesh = makeMesh(net, 'alice@host', 0xa1, 1000, () => 0, spy);
    await mesh.start();
    const peer = attachPeer(net, 'bob@host');
    peer.sendCtrl(peerHelloMsg('bob@host', 999)); // bob is senior
    // Alice is senior? joinedAt alice=1000 vs bob=999 → bob joined earlier → bob is senior.
    // Actually: senior = joined_at < local.joinedAt. 999 < 1000 → bob senior. So alice
    // queues nothing on handleHello. Use the alternate path: send a STATE_REQUEST from
    // bob to queue a pending response.
    peer.sendCtrl({ v: 1, t: 'STATE_REQUEST', from: 'bob@host' });
    // Reset BEFORE any runOnce drains the queue.
    const fresh: GridState = {
      tick: 0,
      config: cfg,
      rng: newRng(cfg.seed),
      players: new Map([['alice@host', makePlayer('alice@host', 4, 1, 0xa1)]]),
      cells: new Map(),
    };
    mesh.reset(fresh);
    // After reset the peer registry is untouched, but pending-state-responses IS
    // cleared. We observe by draining runOnce: no STATE_RESPONSE ever reaches peer.
    peer.clear();
    // Since alice's state has only alice, lockstep is paused. Let the seed timer
    // drive forward by forcing an advance via a new junior peer (re-use peer).
    // Simpler: verify the queue is empty by re-triggering a STATE_REQUEST and
    // observing only ONE outbound STATE_RESPONSE shows up after a runOnce.
    peer.sendCtrl({ v: 1, t: 'STATE_REQUEST', from: 'bob@host' });
    // Advance alice alone — lockstep still paused (bob registered). Force unpause.
    mesh.setLocalInput('');
    // Unpause by injecting another junior peer.
    const later = attachPeer(net, 'late@host');
    later.sendCtrl(peerHelloMsg('late@host', 2000));
    // Now runOnce until at least one tick advances and drain happens.
    for (let i = 0; i < 10; i++) mesh.runOnce(i * 200);
    // Count STATE_RESPONSE messages to 'bob@host'. There should be exactly ONE
    // (the post-reset request), not two (reset discarded the pre-reset request).
    const responses = peer.ctrlIn.filter((e) => e.msg.t === 'STATE_RESPONSE');
    assert.equal(responses.length, 1, 'pre-reset pending STATE_RESPONSE discarded');
    await mesh.stop();
  });

  it('mesh continues to advance ticks after reset (regression guard)', async () => {
    const net = new MockRoomNetwork();
    const clockA = new FakeClock();
    const clockB = new FakeClock();
    const spyA = makeSpy();
    const spyB = makeSpy();
    const both = ['alice@host', 'bob@host'] as const;
    const a = makeMesh(net, 'alice@host', 0xa1, 1000, () => clockA.now, spyA, both);
    const b = makeMesh(net, 'bob@host', 0xb0, 1001, () => clockB.now, spyB, both);
    await a.start();
    await b.start();

    const drain = (now: number): void => {
      let progress = true;
      while (progress) {
        progress = false;
        if (a.runOnce(now) !== null) progress = true;
        if (b.runOnce(now) !== null) progress = true;
      }
    };
    for (let i = 0; i < 5; i++) {
      drain(clockA.now);
      clockA.tick(110);
      clockB.tick(110);
    }
    drain(clockA.now + 10_000);

    const fresh = (): GridState => ({
      tick: 0,
      config: cfg,
      rng: newRng(cfg.seed),
      players: new Map([
        ['alice@host', makePlayer('alice@host', 4, 1, 0xa1)],
        ['bob@host', makePlayer('bob@host', 19, 3, 0xb0)],
      ]),
      cells: new Map(),
    });
    a.reset(fresh());
    b.reset(fresh());

    const tickAfter0 = a.currentState.tick;
    for (let i = 0; i < 10; i++) {
      drain(clockA.now);
      clockA.tick(110);
      clockB.tick(110);
    }
    drain(clockA.now + 10_000);
    assert.ok(a.currentState.tick > tickAfter0, 'advanced after reset');
    assert.equal(a.currentState.tick, b.currentState.tick, 'still in lockstep after dual reset');
    assert.equal(hashState(a.currentState), hashState(b.currentState));
    await a.stop();
    await b.stop();
  });
});

// ===========================================================================
// STATE_RESPONSE sync glue
// ===========================================================================

describe('TileMesh STATE_RESPONSE handling', () => {
  it('rejects STATE_RESPONSE from a different grid (width/height mismatch)', async () => {
    const net = new MockRoomNetwork();
    const spy = makeSpy();
    const mesh = makeMesh(net, 'alice@host', 0xa1, 1000, () => 0, spy);
    await mesh.start();
    const peer = attachPeer(net, 'bob@host');
    peer.sendCtrl(peerHelloMsg('bob@host', 999)); // senior
    const tickBefore = mesh.currentState.tick;

    // Craft a response whose grid config differs.
    const alienConfig: Config = { ...cfg, width: 999, height: 999 };
    const alienState: GridState = {
      tick: 100,
      config: alienConfig,
      rng: newRng(1n),
      players: new Map([['bob@host', makePlayer('bob@host', 50, 1, 0xb0)]]),
      cells: new Map(),
    };
    const resp = buildStateResponse('bob@host', 'alice@host', alienState);
    peer.sendCtrl(resp);

    assert.equal(mesh.currentState.tick, tickBefore, 'snapshot rejected — tick unchanged');
    assert.equal(
      mesh.currentState.config.width,
      cfg.width,
      'grid config not replaced by alien snapshot',
    );
    await mesh.stop();
  });

  it('ignores STATE_RESPONSE whose `to` is not us', async () => {
    const net = new MockRoomNetwork();
    const spy = makeSpy();
    const mesh = makeMesh(net, 'alice@host', 0xa1, 1000, () => 0, spy);
    await mesh.start();
    const peer = attachPeer(net, 'bob@host');
    peer.sendCtrl(peerHelloMsg('bob@host', 999));
    const tickBefore = mesh.currentState.tick;

    const otherState: GridState = {
      tick: 200,
      config: cfg,
      rng: newRng(1n),
      players: new Map([['bob@host', makePlayer('bob@host', 5, 1, 0xb0)]]),
      cells: new Map(),
    };
    const resp = buildStateResponse('bob@host', 'carol@host', otherState);
    peer.sendCtrl(resp);
    assert.equal(mesh.currentState.tick, tickBefore, 'snapshot for someone else ignored');
    await mesh.stop();
  });

  it('ignores STATE_RESPONSE whose `from` is us (ghost peer loopback)', async () => {
    // A stale presence of ourselves on the network sends a STATE_RESPONSE with
    // msg.to = alice AND msg.from = alice. TileMesh must reject it.
    const net = new MockRoomNetwork();
    const spy = makeSpy();
    const mesh = makeMesh(net, 'alice@host', 0xa1, 1000, () => 0, spy);
    await mesh.start();
    const ghost = attachPeer(net, 'ghost-alice');
    // Ghost must be registered first so the session is known. Send a HELLO
    // whose `from` differs so we have a session, then craft a STATE_RESPONSE
    // with `from` === us. Actually the dispatch guard is on `msg.from === localId`
    // BEFORE installSnapshot runs; the session validation is upstream. Use
    // a registered peer's session and a forged `from`. But `from` mismatch
    // with the registered player triggers the earlier validation, not the
    // ghost-loopback branch. To exercise the ghost-loopback branch, register
    // the ghost's HELLO under our own id via an HONEST path — but ghost HELLOs
    // from our own id are rejected earlier (see ghost test). So the branch is
    // reachable only when the transport session is already bound to 'alice'
    // somehow and a STATE_RESPONSE arrives with from=alice. Simulate with a
    // direct crafting: register bob as 'alice@host' via a HELLO — which spoofs
    // — then the dispatch of STATE_RESPONSE never runs because spoof halts
    // before dispatch. So the branch is defensive only, not reachable in
    // normal operation. We assert the code path does not crash if encountered.
    ghost.sendCtrl(peerHelloMsg('ghost@host', 2001));
    // Craft a STATE_RESPONSE from ghost to alice, but with from=alice (forged).
    const ghostState: GridState = {
      tick: 99,
      config: cfg,
      rng: newRng(1n),
      players: new Map([['alice@host', makePlayer('alice@host', 5, 1, 0xa1)]]),
      cells: new Map(),
    };
    const resp = buildStateResponse('alice@host', 'alice@host', ghostState);
    // The from/session mismatch halts dispatch. tick stays at 0.
    ghost.sendCtrl(resp);
    assert.equal(mesh.currentState.tick, 0, 'forged loopback rejected at validation boundary');
    await mesh.stop();
  });
});

// ===========================================================================
// Daemon primitives
// ===========================================================================

describe('TileMesh daemon primitives', () => {
  it('broadcastInput is a no-op when stopped', async () => {
    const net = new MockRoomNetwork();
    const spy = makeSpy();
    const mesh = makeMesh(net, 'alice@host', 0xa1, 1000, () => 0, spy);
    await mesh.start();
    const watcher = attachPeer(net, 'watcher');
    await mesh.stop();
    watcher.clear();
    mesh.broadcastInput('bot.test@test.host', 5, 'L');
    assert.equal(watcher.tickIn.length, 0, 'no broadcast after stop');
  });

  it('broadcastDaemonHello is a no-op when stopped', async () => {
    const net = new MockRoomNetwork();
    const spy = makeSpy();
    const mesh = makeMesh(net, 'alice@host', 0xa1, 1000, () => 0, spy);
    await mesh.start();
    const watcher = attachPeer(net, 'watcher');
    await mesh.stop();
    watcher.clear();
    mesh.broadcastDaemonHello({ daemonId: 'bot.test@test.host', colorSeed: 0xabcdef });
    const helloFromDaemon = watcher.ctrlIn.find(
      (e) => e.msg.t === 'HELLO' && e.msg.from === 'bot.test@test.host',
    );
    assert.equal(helloFromDaemon, undefined, 'no daemon HELLO after stop');
  });

  it('broadcastDaemonHello emits the documented wire format', async () => {
    const net = new MockRoomNetwork();
    const spy = makeSpy();
    const mesh = makeMesh(net, 'alice@host', 0xa1, 1000, () => 0, spy);
    await mesh.start();
    const watcher = attachPeer(net, 'watcher');
    watcher.clear();
    mesh.broadcastDaemonHello({ daemonId: 'bot.test@test.host', colorSeed: 0x123456 });
    const hello = watcher.ctrlIn.find(
      (e) => e.msg.t === 'HELLO' && e.msg.from === 'bot.test@test.host',
    );
    assert.ok(hello, 'daemon HELLO broadcast');
    if (hello && hello.msg.t === 'HELLO') {
      assert.equal(hello.msg.kind, 'daemon');
      assert.equal(hello.msg.color_seed, 0x123456);
      assert.deepEqual(hello.msg.color, [0x56, 0x34, 0x12]);
      assert.ok(typeof hello.msg.joined_at === 'number' && hello.msg.joined_at > 0);
    }
    await mesh.stop();
  });

  it('addPeer / removePeer / queueJoin / recordRemoteInput pass through to lockstep', async () => {
    const net = new MockRoomNetwork();
    const spy = makeSpy();
    const mesh = makeMesh(net, 'alice@host', 0xa1, 1000, () => 0, spy);
    await mesh.start();
    mesh.addPeer('bot.test@test.host');
    assert.equal(mesh.peers.has('bot.test@test.host'), true);
    mesh.queueJoin({ id: 'bot.test@test.host', colorSeed: 0xabc });
    const result = mesh.recordRemoteInput({
      v: 1,
      t: 'INPUT',
      from: 'bot.test@test.host',
      tick: 1,
      i: 'L' as Turn,
    });
    assert.ok(result === 'ok' || result === 'stale' || result === 'ignored');
    mesh.removePeer('bot.test@test.host');
    assert.equal(mesh.peers.has('bot.test@test.host'), false);
    await mesh.stop();
  });
});

// ===========================================================================
// Tick-loop observables
// ===========================================================================

describe('TileMesh tick-loop', () => {
  it('broadcasts STATE_HASH on cadence ticks and advances the chain hash', async () => {
    const net = new MockRoomNetwork();
    const clockA = new FakeClock();
    const clockB = new FakeClock();
    const spyA = makeSpy();
    const spyB = makeSpy();
    const both = ['alice@host', 'bob@host'] as const;
    const a = makeMesh(net, 'alice@host', 0xa1, 1000, () => clockA.now, spyA, both);
    const b = makeMesh(net, 'bob@host', 0xb0, 1001, () => clockB.now, spyB, both);
    await a.start();
    await b.start();
    const watcher = attachPeer(net, 'watcher');

    const drain = (now: number): void => {
      let progress = true;
      while (progress) {
        progress = false;
        if (a.runOnce(now) !== null) progress = true;
        if (b.runOnce(now) !== null) progress = true;
      }
    };
    // Run past tick 30 (the first cadence tick).
    for (let i = 0; i < 40; i++) {
      drain(clockA.now);
      clockA.tick(110);
      clockB.tick(110);
    }
    drain(clockA.now + 10_000);

    const hashes = watcher.tickIn.filter(
      (e) => e.msg.t === 'STATE_HASH' && e.msg.from === 'alice@host',
    );
    assert.ok(hashes.length >= 1, 'at least one STATE_HASH broadcast');
    if (hashes[0] && hashes[0].msg.t === 'STATE_HASH') {
      assert.equal(hashes[0].msg.tick % 30, 0, 'cadence tick is a multiple of 30');
    }
    // Chain hash must have advanced from the all-zero genesis.
    const nonZero = Array.from(a.chainHash).some((b) => b !== 0);
    assert.ok(nonZero, 'chain hash advanced');
    await a.stop();
    await b.stop();
  });

  it('setLocalInput broadcasts an INPUT immediately, before runOnce', async () => {
    const net = new MockRoomNetwork();
    const spy = makeSpy();
    const mesh = makeMesh(net, 'alice@host', 0xa1, 1000, () => 0, spy);
    await mesh.start();
    const watcher = attachPeer(net, 'watcher');
    watcher.clear();
    mesh.setLocalInput('R');
    const input = watcher.tickIn.find((e) => e.msg.t === 'INPUT' && e.msg.from === 'alice@host');
    assert.ok(input, 'INPUT broadcast by setLocalInput');
    if (input && input.msg.t === 'INPUT') {
      assert.equal(input.msg.i, 'R');
    }
    await mesh.stop();
  });
});
