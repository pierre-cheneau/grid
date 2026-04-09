// Tests for collision resolution.

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { resolveMoves } from '../../src/sim/movement.js';
import type { Cell, Config, Direction, Player } from '../../src/sim/types.js';

const cfg: Config = { width: 10, height: 10, halfLifeTicks: 60, seed: 0n, circular: false };

function p(id: string, x: number, y: number, dir: Direction): Player {
  return {
    id,
    pos: { x, y },
    dir,
    isAlive: true,
    respawnAtTick: null,
    score: 0,
    colorSeed: 0,
  };
}

const trail = (ownerId: string, createdAtTick = 0): Cell => ({
  type: 'trail',
  ownerId,
  createdAtTick,
  colorSeed: 0,
});

describe('resolveMoves', () => {
  it('survivors keep moving in clear space', () => {
    const players = new Map([['p:a', p('p:a', 5, 5, 1)]]);
    const { moves } = resolveMoves(cfg, players, new Map());
    const m = moves.get('p:a');
    assert.ok(m?.survived);
    assert.deepEqual(m?.to, { x: 6, y: 5 });
  });

  it('rule 1: out-of-bounds death (no killer)', () => {
    const players = new Map([['p:a', p('p:a', 9, 5, 1)]]);
    const { moves } = resolveMoves(cfg, players, new Map());
    const m = moves.get('p:a');
    assert.equal(m?.survived, false);
    assert.equal(m?.killedBy, null);
  });

  it('rule 2: trail collision credits the trail owner', () => {
    const players = new Map([['p:a', p('p:a', 5, 5, 1)]]);
    const cells = new Map([['00050006', trail('p:b')]]); // (x=6, y=5)
    const { moves } = resolveMoves(cfg, players, cells);
    const m = moves.get('p:a');
    assert.equal(m?.survived, false);
    assert.equal(m?.killedBy, 'p:b');
  });

  it('rule 3: head-on kills both, no killer credited', () => {
    // a at (4,5) facing E, b at (6,5) facing W → both target (5,5).
    const players = new Map([
      ['p:a', p('p:a', 4, 5, 1)],
      ['p:b', p('p:b', 6, 5, 3)],
    ]);
    const { moves } = resolveMoves(cfg, players, new Map());
    assert.equal(moves.get('p:a')?.survived, false);
    assert.equal(moves.get('p:b')?.survived, false);
    assert.equal(moves.get('p:a')?.killedBy, null);
    assert.equal(moves.get('p:b')?.killedBy, null);
  });

  it('rule 4: swap kills both, no killer credited', () => {
    // a at (4,5) facing E, b at (5,5) facing W → they pass through each other.
    const players = new Map([
      ['p:a', p('p:a', 4, 5, 1)],
      ['p:b', p('p:b', 5, 5, 3)],
    ]);
    const { moves } = resolveMoves(cfg, players, new Map());
    assert.equal(moves.get('p:a')?.survived, false);
    assert.equal(moves.get('p:b')?.survived, false);
    assert.equal(moves.get('p:a')?.killedBy, null);
    assert.equal(moves.get('p:b')?.killedBy, null);
  });

  it('skips dead players (no move emitted? actually emits with no survival)', () => {
    const dead: Player = { ...p('p:a', 5, 5, 1), isAlive: false, respawnAtTick: 30 };
    const players = new Map([['p:a', dead]]);
    const { moves } = resolveMoves(cfg, players, new Map());
    assert.equal(moves.size, 0);
  });

  it('two unrelated cycles both survive', () => {
    const players = new Map([
      ['p:a', p('p:a', 1, 1, 1)],
      ['p:b', p('p:b', 8, 8, 3)],
    ]);
    const { moves } = resolveMoves(cfg, players, new Map());
    assert.equal(moves.get('p:a')?.survived, true);
    assert.equal(moves.get('p:b')?.survived, true);
  });
});
