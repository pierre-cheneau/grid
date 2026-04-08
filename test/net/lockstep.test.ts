// Lockstep tests. Uses an injected fake clock so the tests are deterministic.

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { INPUT_TIMEOUT_MS, TICK_DURATION_MS } from '../../src/net/constants.js';
import { Lockstep } from '../../src/net/lockstep.js';
import type { InputMsg } from '../../src/net/messages.js';
import {
  type Config,
  type GridState,
  type Player,
  hashState,
  newRng,
} from '../../src/sim/index.js';

const cfg: Config = { width: 16, height: 16, halfLifeTicks: 30, seed: 0n };

function makeInitial(): GridState {
  const a: Player = {
    id: 'p:a',
    pos: { x: 2, y: 8 },
    dir: 1,
    isAlive: true,
    respawnAtTick: null,
    score: 0,
    colorSeed: 1,
  };
  const b: Player = {
    id: 'p:b',
    pos: { x: 13, y: 8 },
    dir: 3,
    isAlive: true,
    respawnAtTick: null,
    score: 0,
    colorSeed: 2,
  };
  return {
    tick: 0,
    config: cfg,
    rng: newRng(0n),
    players: new Map([
      ['p:a', a],
      ['p:b', b],
    ]),
    cells: new Map(),
  };
}

class FakeClock {
  now = 0;
  read = (): number => this.now;
}

describe('Lockstep', () => {
  it('advances when both peers have submitted inputs', () => {
    const clock = new FakeClock();
    const ls = new Lockstep({
      localId: 'p:a',
      initialState: makeInitial(),
      clock: clock.read,
    });
    ls.addPeer('p:b');
    ls.setLocalInput('');
    ls.recordRemoteInput({ v: 1, t: 'INPUT', from: 'p:b', tick: 1, i: '' });
    // Wall-clock pacing requires at least TICK_DURATION_MS to elapse before the
    // first tick can advance.
    const r = ls.advanceIfReady(clock.now + TICK_DURATION_MS);
    assert.ok(r);
    assert.equal(r.state.tick, 1);
    assert.equal(r.missing.length, 0);
  });

  it('returns null while waiting and the deadline has not passed', () => {
    const clock = new FakeClock();
    const ls = new Lockstep({
      localId: 'p:a',
      initialState: makeInitial(),
      clock: clock.read,
    });
    ls.addPeer('p:b');
    ls.setLocalInput('');
    // p:b has not sent yet.
    assert.equal(ls.advanceIfReady(clock.now + 50), null);
  });

  it('defaults missing inputs to "" and flags the peer at the deadline', () => {
    const clock = new FakeClock();
    const ls = new Lockstep({
      localId: 'p:a',
      initialState: makeInitial(),
      clock: clock.read,
    });
    ls.addPeer('p:b');
    ls.setLocalInput('');
    const r = ls.advanceIfReady(clock.now + TICK_DURATION_MS + INPUT_TIMEOUT_MS + 1);
    assert.ok(r);
    assert.deepEqual(r.missing, ['p:b']);
    assert.equal(r.state.tick, 1);
  });

  it('two peers run in parallel and converge to identical hashes', () => {
    const clockA = new FakeClock();
    const clockB = new FakeClock();
    const lsA = new Lockstep({
      localId: 'p:a',
      initialState: makeInitial(),
      clock: clockA.read,
    });
    const lsB = new Lockstep({
      localId: 'p:b',
      initialState: makeInitial(),
      clock: clockB.read,
    });
    lsA.addPeer('p:b');
    lsB.addPeer('p:a');

    // 100 ticks of straight cycling. Advance the clock by TICK_DURATION_MS each loop.
    for (let t = 1; t <= 100; t++) {
      clockA.now += TICK_DURATION_MS;
      clockB.now += TICK_DURATION_MS;
      lsA.setLocalInput('');
      lsB.setLocalInput('');
      const aMsg: InputMsg = { v: 1, t: 'INPUT', from: 'p:a', tick: t, i: '' };
      const bMsg: InputMsg = { v: 1, t: 'INPUT', from: 'p:b', tick: t, i: '' };
      lsA.recordRemoteInput(bMsg);
      lsB.recordRemoteInput(aMsg);
      const rA = lsA.advanceIfReady(clockA.now);
      const rB = lsB.advanceIfReady(clockB.now);
      assert.ok(rA && rB);
      assert.equal(hashState(rA.state), hashState(rB.state), `divergence at tick ${t}`);
    }
  });

  it('drops inputs more than MAX_INBOUND_BUFFER_TICKS ahead', () => {
    const clock = new FakeClock();
    const ls = new Lockstep({
      localId: 'p:a',
      initialState: makeInitial(),
      clock: clock.read,
    });
    ls.addPeer('p:b');
    // way ahead — should be dropped silently
    ls.recordRemoteInput({ v: 1, t: 'INPUT', from: 'p:b', tick: 999, i: 'L' });
    ls.setLocalInput('');
    // Without the timeout we should still be waiting (p:b's tick=999 input was dropped).
    assert.equal(ls.advanceIfReady(clock.now + 50), null);
    // Past the deadline → defaults p:b to '' and flags it.
    const r = ls.advanceIfReady(clock.now + TICK_DURATION_MS + INPUT_TIMEOUT_MS + 1);
    assert.ok(r);
    assert.deepEqual(r.missing, ['p:b']);
  });
});
