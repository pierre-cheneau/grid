// The Stage 2 acceptance test: two NetClients in one process, wired through MockRoom,
// run a 200-tick scenario and end with byte-identical state hashes.

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { NetClient } from '../../src/net/client.js';
import {
  type Config,
  type GridState,
  type Player,
  hashState,
  newRng,
} from '../../src/sim/index.js';
import { MockRoomNetwork } from './mock-room.js';

const cfg: Config = { width: 24, height: 24, halfLifeTicks: 60, seed: 0xc0ffeen };

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
      },
      { roomFactory: factory, clock: () => clockA.now },
    );
    const b = new NetClient(
      {
        roomKey: 'grid:test',
        identity: { id: 'bob@host', colorSeed: 0xb0b, joinedAt: 1001 },
        initialState: initialState(),
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
      },
      { roomFactory: factory, clock: () => clock.now },
    );
    const b = new NetClient(
      {
        roomKey: 'grid:test',
        identity: { id: 'bob@host', colorSeed: 2, joinedAt: 1001 },
        initialState: initialState(),
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
});
