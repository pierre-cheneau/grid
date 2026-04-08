// Tests for the canonical state hash.
//
// THE PINNED VECTOR in this file locks the entire canonical byte format. If this test
// fails, either:
//   1. You changed `serialize.ts` (the byte layout) — you must bump FORMAT_VERSION
//      and re-pin this hash, AND every replay file in the wild is now invalid.
//   2. You changed `hash.ts` (truncation, hash function, encoding) — same consequence.
//   3. You found a real determinism bug — fix the bug, do not re-pin.
//
// If you're not sure which case you're in, the answer is "ask before re-pinning".

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { hashState } from '../../src/sim/hash.js';
import type { Cell, Config, GridState, Player } from '../../src/sim/types.js';

const cfg: Config = { width: 32, height: 16, halfLifeTicks: 60, seed: 0xc0ffee_deadbeefn };

const knownPlayer: Player = {
  id: 'p:alice',
  pos: { x: 5, y: 7 },
  dir: 1,
  isAlive: true,
  respawnAtTick: null,
  score: 3,
  colorSeed: 0x1234_5678,
};

const knownCell: Cell = {
  type: 'trail',
  ownerId: 'p:alice',
  createdAtTick: 1,
};

function knownState(): GridState {
  return {
    tick: 42,
    config: cfg,
    rng: { state: 0xdead_beef_cafe_baben },
    players: new Map([['p:alice', knownPlayer]]),
    cells: new Map([['00070005', knownCell]]),
  };
}

describe('hashState', () => {
  it('returns a 16-char lowercase hex string', () => {
    const h = hashState(knownState());
    assert.equal(h.length, 16);
    assert.match(h, /^[0-9a-f]{16}$/);
  });

  it('is stable across calls (purity)', () => {
    const s = knownState();
    assert.equal(hashState(s), hashState(s));
  });

  it('is independent of map insertion order', () => {
    const s1 = knownState();
    const s2: GridState = {
      ...s1,
      players: new Map([['p:alice', knownPlayer]]),
      cells: new Map([['00070005', knownCell]]),
    };
    assert.equal(hashState(s1), hashState(s2));
  });

  it('changes when any field changes', () => {
    const base = hashState(knownState());
    const s2: GridState = { ...knownState(), tick: 43 };
    assert.notEqual(base, hashState(s2));
  });

  // PINNED VECTOR — the canary for the entire canonical format.
  it('produces the pinned hash for the known state', () => {
    assert.equal(hashState(knownState()), 'dd408dd20a84e132');
  });
});
