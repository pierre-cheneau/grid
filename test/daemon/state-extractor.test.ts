import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { extractDaemonTick } from '../../src/daemon/state-extractor.js';
import { cellKey } from '../../src/sim/grid.js';
import type { Cell, Config, GridState, Player } from '../../src/sim/types.js';

const CONFIG: Config = { width: 80, height: 40, halfLifeTicks: 100, seed: 0n, circular: false };

function makePlayer(id: string, x: number, y: number, dir: 0 | 1 | 2 | 3, alive = true): Player {
  return { id, pos: { x, y }, dir, isAlive: alive, respawnAtTick: null, score: 0, colorSeed: 0 };
}

function makeState(
  tick: number,
  players: Player[],
  cells: Map<string, Cell> = new Map(),
): GridState {
  const pm = new Map<string, Player>();
  for (const p of players) pm.set(p.id, p);
  return { tick, config: CONFIG, rng: { state: 0n }, players: pm, cells };
}

describe('extractDaemonTick', () => {
  it('extracts you, others, and cells correctly', () => {
    const daemon = makePlayer('bot.test@user.host', 10, 20, 1);
    const pilot = makePlayer('user@host', 30, 5, 0);
    const cells = new Map<string, Cell>([
      [cellKey(10, 19), { type: 'trail', ownerId: 'user@host', createdAtTick: 90, colorSeed: 0 }],
    ]);
    const state = makeState(100, [daemon, pilot], cells);
    const tick = extractDaemonTick(state, 'bot.test@user.host');

    assert.equal(tick.t, 'TICK');
    assert.equal(tick.n, 100);
    assert.deepEqual(tick.you, { x: 10, y: 20, dir: 'E', alive: true, score: 0 });
    assert.equal(tick.others.length, 1);
    assert.equal(tick.others[0]?.id, 'user@host');
    assert.equal(tick.others[0]?.dir, 'N');
    assert.equal(tick.cells.length, 1);
    assert.equal(tick.cells[0]?.x, 10);
    assert.equal(tick.cells[0]?.y, 19);
    assert.equal(tick.cells[0]?.age, 10);
  });

  it('returns dead self when daemon not in state', () => {
    const state = makeState(50, []);
    const tick = extractDaemonTick(state, 'bot.test@user.host');

    assert.equal(tick.you.alive, false);
    assert.equal(tick.you.x, 0);
    assert.equal(tick.you.y, 0);
  });

  it('returns dead self when daemon is dead', () => {
    const daemon = makePlayer('bot.test@user.host', 15, 25, 2, false);
    const state = makeState(200, [daemon]);
    const tick = extractDaemonTick(state, 'bot.test@user.host');

    assert.equal(tick.you.alive, false);
    assert.equal(tick.you.x, 15);
    assert.equal(tick.you.y, 25);
    assert.equal(tick.you.dir, 'S');
  });

  it('excludes dead players from others', () => {
    const daemon = makePlayer('bot.test@user.host', 10, 20, 1);
    const alive = makePlayer('alive@host', 30, 5, 0);
    const dead = makePlayer('dead@host', 40, 10, 3, false);
    const state = makeState(100, [daemon, alive, dead]);
    const tick = extractDaemonTick(state, 'bot.test@user.host');

    assert.equal(tick.others.length, 1);
    assert.equal(tick.others[0]?.id, 'alive@host');
  });

  it('maps all four directions correctly', () => {
    for (const [dir, expected] of [
      [0, 'N'],
      [1, 'E'],
      [2, 'S'],
      [3, 'W'],
    ] as const) {
      const daemon = makePlayer('bot.test@user.host', 0, 0, dir);
      const state = makeState(0, [daemon]);
      const tick = extractDaemonTick(state, 'bot.test@user.host');
      assert.equal(tick.you.dir, expected);
    }
  });

  it('returns empty arrays when no cells or others', () => {
    const daemon = makePlayer('bot.test@user.host', 5, 5, 0);
    const state = makeState(10, [daemon]);
    const tick = extractDaemonTick(state, 'bot.test@user.host');

    assert.deepEqual(tick.others, []);
    assert.deepEqual(tick.cells, []);
  });

  it('computes age as tick minus createdAtTick', () => {
    const daemon = makePlayer('bot.test@user.host', 5, 5, 0);
    const cells = new Map<string, Cell>([
      [cellKey(1, 1), { type: 'trail', ownerId: 'x@y', createdAtTick: 0, colorSeed: 0 }],
      [cellKey(2, 2), { type: 'trail', ownerId: 'x@y', createdAtTick: 90, colorSeed: 0 }],
    ]);
    const state = makeState(100, [daemon], cells);
    const tick = extractDaemonTick(state, 'bot.test@user.host');

    const ages = tick.cells.map((c) => c.age).sort((a, b) => a - b);
    assert.deepEqual(ages, [10, 100]);
  });
});
