// Tests for the public `simulateTick` entry point.

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { RESPAWN_TICKS } from '../../src/sim/constants.js';
import { hashState } from '../../src/sim/hash.js';
import { simulateTick } from '../../src/sim/tick.js';
import type { GridState, Inputs } from '../../src/sim/types.js';
import { emptyState, makeConfig, makePlayer, withPlayers } from './fixtures.js';

const noInputs: Inputs = { turns: new Map(), joins: [] };

function step(state: GridState, count: number, inputs: Inputs = noInputs): GridState {
  let s = state;
  for (let i = 0; i < count; i++) s = simulateTick(s, inputs);
  return s;
}

describe('simulateTick', () => {
  it('advances the tick counter by exactly 1', () => {
    const s = emptyState();
    assert.equal(simulateTick(s, noInputs).tick, 1);
  });

  it('does not mutate the prior state', () => {
    const s = withPlayers(emptyState(), [makePlayer('p:a', 5, 5, 1)]);
    const beforeHash = hashState(s);
    simulateTick(s, noInputs);
    assert.equal(hashState(s), beforeHash);
  });

  it('moves a lone cycle one cell per tick and lays a trail behind it', () => {
    const s = withPlayers(emptyState(), [makePlayer('p:a', 2, 2, 1)]); // facing E
    const s1 = simulateTick(s, noInputs);
    const a = s1.players.get('p:a');
    assert.deepEqual(a?.pos, { x: 3, y: 2 });
    // Trail should exist at the previous position (2, 2).
    assert.equal(s1.cells.size, 1);
    const cell = s1.cells.values().next().value;
    assert.equal(cell?.ownerId, 'p:a');
    assert.equal(cell?.createdAtTick, 1);
  });

  it('determinism: same inputs from same state produce identical hashes', () => {
    const s = withPlayers(emptyState(), [makePlayer('p:a', 2, 2, 1), makePlayer('p:b', 12, 12, 3)]);
    const a = step(s, 5);
    const b = step(s, 5);
    assert.equal(hashState(a), hashState(b));
  });

  it('exit input ("X") removes a player from the world', () => {
    const s = withPlayers(emptyState(), [makePlayer('p:a', 5, 5, 1)]);
    const inputs: Inputs = { turns: new Map([['p:a', 'X']]), joins: [] };
    const s1 = simulateTick(s, inputs);
    assert.equal(s1.players.size, 0);
  });

  it('a derezzed player respawns exactly RESPAWN_TICKS later', () => {
    // Put p:a one cell from the wall, facing E. Next tick: out-of-bounds death.
    const cfg = makeConfig({ width: 6, height: 6 });
    const s = withPlayers(emptyState(cfg), [makePlayer('p:a', 5, 3, 1)]);
    const s1 = simulateTick(s, noInputs);
    assert.equal(s1.players.get('p:a')?.isAlive, false);
    assert.equal(s1.players.get('p:a')?.respawnAtTick, 1 + RESPAWN_TICKS);
    // Step forward until respawn lands.
    const sR = step(s1, RESPAWN_TICKS);
    assert.equal(sR.players.get('p:a')?.isAlive, true);
    assert.equal(sR.players.get('p:a')?.respawnAtTick, null);
  });

  it('kill credit: cycle entering an enemy trail awards score to the trail owner', () => {
    // Pre-seed an a-owned trail at (3,5). p:b at (2,5) facing E will walk into it.
    const cfg = makeConfig({ width: 16, height: 16 });
    const s: GridState = {
      ...withPlayers(emptyState(cfg), [makePlayer('p:a', 10, 10, 1), makePlayer('p:b', 2, 5, 1)]),
      cells: new Map([['00050003', { type: 'trail', ownerId: 'p:a', createdAtTick: 0 }]]),
    };
    const s1 = simulateTick(s, noInputs);
    assert.equal(s1.players.get('p:b')?.isAlive, false);
    assert.equal(s1.players.get('p:a')?.score, 1);
  });
});
