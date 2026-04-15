// The Stage 2 acceptance test: two NetClients in one process, wired through MockRoom,
// run a 200-tick scenario and end with byte-identical state hashes.

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { DaemonBridgeConfig } from '../../src/daemon/bridge.js';
import { NetClient } from '../../src/net/client.js';
import {
  type Config,
  type GridState,
  type Player,
  hashState,
  newRng,
} from '../../src/sim/index.js';
import { MockRoomNetwork } from './mock-room.js';

const cfg: Config = { width: 24, height: 24, halfLifeTicks: 60, seed: 0xc0ffeen, circular: false };

function initialState(): GridState {
  const a: Player = {
    id: 'alice@host',
    pos: { x: 4, y: 12 },
    dir: 1,
    isAlive: true,
    respawnAtTick: null,
    score: 0,
    colorSeed: 0xa11ce,
  };
  const b: Player = {
    id: 'bob@host',
    pos: { x: 19, y: 12 },
    dir: 3,
    isAlive: true,
    respawnAtTick: null,
    score: 0,
    colorSeed: 0xb0b,
  };
  return {
    tick: 0,
    config: cfg,
    rng: newRng(cfg.seed),
    players: new Map([
      ['alice@host', a],
      ['bob@host', b],
    ]),
    cells: new Map(),
  };
}

class FakeClock {
  now = 0;
  tick(ms: number): void {
    this.now += ms;
  }
}

describe('NetClient integration via MockRoom', () => {
  it('two clients converge to identical hashes after 200 ticks', async () => {
    const net = new MockRoomNetwork();
    const factory = net.factory();
    const clockA = new FakeClock();
    const clockB = new FakeClock();

    const a = new NetClient(
      {
        roomKey: 'grid:test',
        identity: { id: 'alice@host', colorSeed: 0xa11ce, joinedAt: 1000 },
        initialState: initialState(),
        homeTile: { x: 0, y: 0 },
      },
      { roomFactory: factory, clock: () => clockA.now },
    );
    const b = new NetClient(
      {
        roomKey: 'grid:test',
        identity: { id: 'bob@host', colorSeed: 0xb0b, joinedAt: 1001 },
        initialState: initialState(),
        homeTile: { x: 0, y: 0 },
      },
      { roomFactory: factory, clock: () => clockB.now },
    );

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

    for (let i = 0; i < 200; i++) {
      drain(clockA.now);
      clockA.tick(110);
      clockB.tick(110);
    }
    drain(clockA.now + 10_000);

    assert.equal(a.currentState.tick, b.currentState.tick, 'tick drift');
    assert.equal(hashState(a.currentState), hashState(b.currentState), 'state hash drift');

    await a.stop();
    await b.stop();
  });

  it('a turn input from one client propagates and changes both states identically', async () => {
    const net = new MockRoomNetwork();
    const factory = net.factory();
    const clock = new FakeClock();
    const a = new NetClient(
      {
        roomKey: 'grid:test',
        identity: { id: 'alice@host', colorSeed: 1, joinedAt: 1000 },
        initialState: initialState(),
        homeTile: { x: 0, y: 0 },
      },
      { roomFactory: factory, clock: () => clock.now },
    );
    const b = new NetClient(
      {
        roomKey: 'grid:test',
        identity: { id: 'bob@host', colorSeed: 2, joinedAt: 1001 },
        initialState: initialState(),
        homeTile: { x: 0, y: 0 },
      },
      { roomFactory: factory, clock: () => clock.now },
    );
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
    a.setLocalInput('L');
    for (let i = 0; i < 5; i++) {
      drain(clock.now);
      clock.tick(110);
    }
    drain(clock.now);
    assert.equal(hashState(a.currentState), hashState(b.currentState));
    await a.stop();
    await b.stop();
  });

  /**
   * Regression test for the Stage 5.1 bug cluster: parser namespace, HELLO race,
   * missing JoinRequest, no joiner sync. The realistic CLI case where each peer
   * starts with ONLY its local player in the initial state, joins late, and must
   * converge via HELLO + JoinRequest + STATE_REQUEST/RESPONSE.
   */
  it('late joiner installs senior state and converges (realistic CLI flow)', async () => {
    const net = new MockRoomNetwork();
    const factory = net.factory();
    const clock = new FakeClock();

    // Each client's initial state contains ONLY its own player. This is what
    // src/cli/grid.ts does, and what real `npx grid` produces. The senior's HELLO
    // must teach the junior about the senior, and a STATE_REQUEST/RESPONSE round-
    // trip must replace the junior's local state with the senior's authoritative one.
    const aliceOnly = (): GridState => ({
      tick: 0,
      config: cfg,
      rng: newRng(cfg.seed),
      players: new Map([
        [
          'alice@host',
          {
            id: 'alice@host',
            pos: { x: 4, y: 12 },
            dir: 1,
            isAlive: true,
            respawnAtTick: null,
            score: 0,
            colorSeed: 0xa11ce,
          } satisfies Player,
        ],
      ]),
      cells: new Map(),
    });
    const bobOnly = (): GridState => ({
      tick: 0,
      config: cfg,
      rng: newRng(cfg.seed),
      players: new Map([
        [
          'bob@host',
          {
            id: 'bob@host',
            pos: { x: 19, y: 12 },
            dir: 3,
            isAlive: true,
            respawnAtTick: null,
            score: 0,
            colorSeed: 0xb0b,
          } satisfies Player,
        ],
      ]),
      cells: new Map(),
    });

    const a = new NetClient(
      {
        roomKey: 'grid:test',
        identity: { id: 'alice@host', colorSeed: 0xa11ce, joinedAt: 1000 },
        initialState: aliceOnly(),
        homeTile: { x: 0, y: 0 },
      },
      { roomFactory: factory, clock: () => clock.now },
    );
    const b = new NetClient(
      {
        roomKey: 'grid:test',
        identity: { id: 'bob@host', colorSeed: 0xb0b, joinedAt: 1001 },
        initialState: bobOnly(),
        homeTile: { x: 0, y: 0 },
      },
      { roomFactory: factory, clock: () => clock.now },
    );

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

    // Run 50 ticks. After convergence, both clients should hold a state that
    // contains BOTH players in identical positions and produces the same hash.
    for (let i = 0; i < 50; i++) {
      drain(clock.now);
      clock.tick(110);
    }
    drain(clock.now);

    assert.equal(a.currentState.players.size, 2, 'alice should know both players');
    assert.equal(b.currentState.players.size, 2, 'bob should know both players');
    assert.ok(a.currentState.players.has('alice@host'));
    assert.ok(a.currentState.players.has('bob@host'));
    assert.ok(b.currentState.players.has('alice@host'));
    assert.ok(b.currentState.players.has('bob@host'));
    assert.equal(a.currentState.tick, b.currentState.tick, 'tick drift');
    assert.equal(
      hashState(a.currentState),
      hashState(b.currentState),
      'state hash drift after joiner sync',
    );

    await a.stop();
    await b.stop();
  });

  /**
   * Regression test for the "input pressed late" bug: the local user presses a
   * turn AFTER the first broadcast for the current tick has already gone out.
   * Without re-broadcasting on every runOnce, the local peer applies the turn but
   * the remote peer's buffer still has the empty original — divergence.
   */
  it('a turn pressed AFTER the first broadcast still propagates to the other peer', async () => {
    const net = new MockRoomNetwork();
    const factory = net.factory();
    const clock = new FakeClock();
    const a = new NetClient(
      {
        roomKey: 'grid:test',
        identity: { id: 'alice@host', colorSeed: 1, joinedAt: 1000 },
        initialState: initialState(),
        homeTile: { x: 0, y: 0 },
      },
      { roomFactory: factory, clock: () => clock.now },
    );
    const b = new NetClient(
      {
        roomKey: 'grid:test',
        identity: { id: 'bob@host', colorSeed: 2, joinedAt: 1001 },
        initialState: initialState(),
        homeTile: { x: 0, y: 0 },
      },
      { roomFactory: factory, clock: () => clock.now },
    );
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

    // First drain: both peers broadcast INPUT{tick:1, i:''} for the pending tick.
    // No tick advance yet (clock=0 < pacing minimum).
    drain(clock.now);
    // NOW the user presses a turn — AFTER the empty broadcast went out.
    a.setLocalInput('L');
    // Time passes, drain runs the tick advance. Without the fix, A would apply L
    // locally (via lockstep.localPending) and B would still have alice='' in its
    // buffer for tick 1, producing different states.
    for (let i = 0; i < 5; i++) {
      clock.tick(110);
      drain(clock.now);
    }
    assert.equal(
      hashState(a.currentState),
      hashState(b.currentState),
      'L pressed after first broadcast must still propagate',
    );
    await a.stop();
    await b.stop();
  });

  /**
   * Regression test for the parser/sender namespace bug: ensures parseMessage
   * does NOT depend on the transport sender id matching the player id, and that
   * NetClient correctly maps opaque session ids to player ids via HELLO.
   */
  it('rejects messages from a session that has not yet sent HELLO', async () => {
    const net = new MockRoomNetwork();
    const factory = net.factory();
    const clock = new FakeClock();
    const a = new NetClient(
      {
        roomKey: 'grid:test',
        identity: { id: 'alice@host', colorSeed: 1, joinedAt: 1000 },
        initialState: initialState(),
        homeTile: { x: 0, y: 0 },
      },
      { roomFactory: factory, clock: () => clock.now },
    );
    await a.start();

    // Inject a "rogue" peer that sends INPUT without ever sending HELLO first.
    // The fault counter should accumulate but the client should not crash.
    const rogueRoom = net.createRoom('rogue@host');
    rogueRoom.sendTick(JSON.stringify({ v: 1, t: 'INPUT', from: 'rogue@host', tick: 1, i: 'L' }));
    // Since alice never received HELLO from the rogue, the dispatch should not have
    // injected the rogue's input into alice's lockstep.
    // We can verify by running a tick and checking alice's state has not been
    // affected by a phantom rogue@host player.
    clock.tick(150);
    a.runOnce(clock.now);
    assert.ok(!a.currentState.players.has('rogue@host'));

    await a.stop();
    await rogueRoom.leave();
  });

  it('deployDaemon after stop throws rather than leaking a subprocess', async () => {
    const net = new MockRoomNetwork();
    const factory = net.factory();
    const clock = new FakeClock();
    const a = new NetClient(
      {
        roomKey: 'grid:test',
        identity: { id: 'alice@host', colorSeed: 1, joinedAt: 1000 },
        initialState: initialState(),
        homeTile: { x: 0, y: 0 },
      },
      { roomFactory: factory, clock: () => clock.now },
    );
    await a.start();
    await a.stop();
    const config: DaemonBridgeConfig = {
      scriptPath: '/nonexistent.cjs',
      daemonId: 'bot.test@alice.host',
      colorSeed: 0x123456,
      gridWidth: cfg.width,
      gridHeight: cfg.height,
    };
    // If the guard were absent, this would spawn a subprocess via
    // createSubprocessTransport before we got a chance to observe it.
    await assert.rejects(a.deployDaemon(config), /cannot deploy daemon after/);
  });
});
