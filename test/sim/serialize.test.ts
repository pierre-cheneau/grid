// Tests for canonical byte serialization.
//
// The most important test in this file is `insertion-order independence`: it directly
// asserts the property that the canonical hash is built on. If this test ever fails,
// every replay file in the wild is invalid.

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { canonicalBytes } from '../../src/sim/serialize.js';
import type { Cell, Config, GridState, Player } from '../../src/sim/types.js';

const cfg: Config = { width: 32, height: 16, halfLifeTicks: 60, seed: 0xc0ffeen };

function makePlayer(id: string, x: number, y: number, score = 0): Player {
  return {
    id,
    pos: { x, y },
    dir: 1,
    isAlive: true,
    respawnAtTick: null,
    score,
    colorSeed: 0xdeadbeef,
  };
}

function makeCell(ownerId: string, createdAtTick = 1): Cell {
  return { type: 'trail', ownerId, createdAtTick };
}

function emptyState(): GridState {
  return {
    tick: 0,
    config: cfg,
    rng: { state: 0x1234_5678_9abc_def0n },
    players: new Map(),
    cells: new Map(),
  };
}

describe('canonicalBytes', () => {
  it('starts with the GRID magic and version 1', () => {
    const bytes = canonicalBytes(emptyState());
    assert.equal(bytes[0], 0x47); // 'G'
    assert.equal(bytes[1], 0x52); // 'R'
    assert.equal(bytes[2], 0x49); // 'I'
    assert.equal(bytes[3], 0x44); // 'D'
    assert.equal(bytes[4], 1); // version
  });

  it('produces the same bytes regardless of player insertion order', () => {
    const a: GridState = {
      ...emptyState(),
      players: new Map([
        ['p:alice', makePlayer('p:alice', 1, 2)],
        ['p:bob', makePlayer('p:bob', 3, 4)],
        ['p:carol', makePlayer('p:carol', 5, 6)],
      ]),
    };
    const b: GridState = {
      ...emptyState(),
      players: new Map([
        ['p:carol', makePlayer('p:carol', 5, 6)],
        ['p:alice', makePlayer('p:alice', 1, 2)],
        ['p:bob', makePlayer('p:bob', 3, 4)],
      ]),
    };
    assert.deepEqual(canonicalBytes(a), canonicalBytes(b));
  });

  it('produces the same bytes regardless of cell insertion order', () => {
    const a: GridState = {
      ...emptyState(),
      cells: new Map([
        ['00010001', makeCell('p:alice')],
        ['00020002', makeCell('p:bob')],
        ['00030003', makeCell('p:carol')],
      ]),
    };
    const b: GridState = {
      ...emptyState(),
      cells: new Map([
        ['00030003', makeCell('p:carol')],
        ['00010001', makeCell('p:alice')],
        ['00020002', makeCell('p:bob')],
      ]),
    };
    assert.deepEqual(canonicalBytes(a), canonicalBytes(b));
  });

  it('detects field changes (every byte is load-bearing)', () => {
    const base = emptyState();
    const tweaked: GridState = { ...base, tick: 1 };
    assert.notDeepEqual(canonicalBytes(base), canonicalBytes(tweaked));
  });

  it('encodes respawnAtTick null vs present distinctly', () => {
    const alive: GridState = {
      ...emptyState(),
      players: new Map([['p:a', makePlayer('p:a', 0, 0)]]),
    };
    const dead: GridState = {
      ...emptyState(),
      players: new Map([
        [
          'p:a',
          { ...makePlayer('p:a', 0, 0), isAlive: false, respawnAtTick: 30 },
        ],
      ]),
    };
    assert.notDeepEqual(canonicalBytes(alive), canonicalBytes(dead));
  });
});
