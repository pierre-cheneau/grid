import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { cellKey } from '../../src/sim/grid.js';
import { newRng } from '../../src/sim/rng.js';
import type { Cell, GridState, Player } from '../../src/sim/types.js';
import { DayTracker } from '../../src/stats/day.js';

const cfg = { width: 16, height: 16, halfLifeTicks: 30, seed: 0n, circular: false };

function makeCell(ownerId: string, tick = 0): Cell {
  return { type: 'trail', ownerId, createdAtTick: tick, colorSeed: 0 };
}

function makeState(players: Player[], tick = 0, cells: Map<string, Cell> = new Map()): GridState {
  const map = new Map(players.map((p) => [p.id, p]));
  return { tick, config: cfg, rng: newRng(0n), players: map, cells };
}

function player(id: string, isAlive: boolean, score = 0): Player {
  return { id, pos: { x: 0, y: 0 }, dir: 1, isAlive, respawnAtTick: null, score, colorSeed: 0 };
}

describe('DayTracker', () => {
  it('tracks longest alive streak in wall-clock ms', () => {
    const t = new DayTracker();
    t.observe(makeState([player('a', true)]), 1000);
    t.observe(makeState([player('a', true)]), 1500);
    const s = t.finalize(2000);
    assert.equal(s.players.get('a')?.longestAliveMs, 1000);
  });

  it('tracks the longest of multiple streaks', () => {
    const t = new DayTracker();
    // First streak: 500ms
    t.observe(makeState([player('a', true)]), 1000);
    t.observe(makeState([player('a', false)]), 1500);
    // Second streak: 800ms
    t.observe(makeState([player('a', true)]), 2000);
    t.observe(makeState([player('a', false)]), 2800);
    const s = t.finalize(3000);
    assert.equal(s.players.get('a')?.longestAliveMs, 800);
  });

  it('counts kills from score deltas', () => {
    const t = new DayTracker();
    t.observe(makeState([player('a', true, 0)]), 1000);
    t.observe(makeState([player('a', true, 3)]), 1100);
    t.observe(makeState([player('a', true, 5)]), 1200);
    const s = t.finalize(1300);
    assert.equal(s.players.get('a')?.kills, 5);
    assert.equal(s.totalKills, 5);
  });

  it('isolates per-player stats', () => {
    const t = new DayTracker();
    t.observe(makeState([player('a', true, 0), player('b', true, 0)]), 1000);
    t.observe(makeState([player('a', true, 2), player('b', true, 1)]), 1100);
    const s = t.finalize(1200);
    assert.equal(s.players.get('a')?.kills, 2);
    assert.equal(s.players.get('b')?.kills, 1);
    assert.equal(s.playerCount, 2);
  });

  it('tracks peak concurrent alive count', () => {
    const t = new DayTracker();
    t.observe(makeState([player('a', true), player('b', true), player('c', true)]), 1000);
    t.observe(makeState([player('a', true), player('b', false)]), 1100);
    const s = t.finalize(1200);
    assert.equal(s.peakConcurrent, 3);
  });

  it('handles empty state (no players)', () => {
    const t = new DayTracker();
    t.observe(makeState([]), 1000);
    const s = t.finalize(2000);
    assert.equal(s.playerCount, 0);
    assert.equal(s.peakConcurrent, 0);
    assert.equal(s.totalKills, 0);
  });

  it('handles player that joins dead', () => {
    const t = new DayTracker();
    t.observe(makeState([player('a', false)]), 1000);
    t.observe(makeState([player('a', true)]), 2000);
    t.observe(makeState([player('a', false)]), 3000);
    const s = t.finalize(3500);
    assert.equal(s.players.get('a')?.longestAliveMs, 1000);
  });

  it('handles player disappearing from state', () => {
    const t = new DayTracker();
    t.observe(makeState([player('a', true), player('b', true)]), 1000);
    // Player 'b' disconnects — absent from next observe calls.
    // Their alive streak remains open until finalize closes it.
    t.observe(makeState([player('a', true)]), 2000);
    const s = t.finalize(3000);
    assert.equal(s.playerCount, 2);
    assert.equal(s.players.get('a')?.longestAliveMs, 2000);
    // 'b' streak was open from t=1000, closed at finalize t=3000
    assert.equal(s.players.get('b')?.longestAliveMs, 2000);
  });

  it('finalize on empty tracker returns zero stats', () => {
    const t = new DayTracker();
    const s = t.finalize(5000);
    assert.equal(s.playerCount, 0);
    assert.equal(s.peakConcurrent, 0);
    assert.equal(s.totalKills, 0);
  });

  it('snapshot is non-destructive', () => {
    const t = new DayTracker();
    t.observe(makeState([player('a', true)]), 1000);
    const s1 = t.snapshot(2000);
    assert.equal(s1.players.get('a')?.longestAliveMs, 1000);
    // Continue observing — the streak should extend
    t.observe(makeState([player('a', true)]), 2500);
    const s2 = t.snapshot(3000);
    assert.equal(s2.players.get('a')?.longestAliveMs, 2000);
  });

  // ---- Cell integral (Architect crown) ----

  it('accumulates cellIntegral on sample ticks (every 10)', () => {
    const t = new DayTracker();
    const cells = new Map([
      [cellKey(1, 1), makeCell('a')],
      [cellKey(2, 2), makeCell('a')],
    ]);
    // First observe at tick 0 → registers player 'a'.
    t.observe(makeState([player('a', true)], 0, cells), 1000);
    // tick 0 is a sample tick (0 - (-1) >= 10 on first call), so integral = 2 * 10 = 20.
    const s = t.snapshot(1001);
    assert.equal(s.players.get('a')?.cellIntegral, 20);
  });

  it('does NOT accumulate cellIntegral on non-sample ticks', () => {
    const t = new DayTracker();
    const cells = new Map([[cellKey(1, 1), makeCell('a')]]);
    t.observe(makeState([player('a', true)], 0, cells), 1000);
    const after0 = t.snapshot(1001).players.get('a')?.cellIntegral ?? 0;
    // Ticks 1-9 should not trigger sampling.
    for (let tick = 1; tick <= 9; tick++) {
      t.observe(makeState([player('a', true)], tick, cells), 1000 + tick);
    }
    const after9 = t.snapshot(1010).players.get('a')?.cellIntegral ?? 0;
    assert.equal(after9, after0); // No change between tick 1-9.
    // Tick 10 triggers sampling again.
    t.observe(makeState([player('a', true)], 10, cells), 1010);
    const after10 = t.snapshot(1011).players.get('a')?.cellIntegral ?? 0;
    assert.equal(after10, after0 + 10); // +10 for 1 cell * 10 interval.
  });

  it('skips cells owned by unknown players in integral', () => {
    const t = new DayTracker();
    // Cell owned by 'unknown' who is not in the player list.
    const cells = new Map([[cellKey(1, 1), makeCell('unknown@h')]]);
    t.observe(makeState([player('a', true)], 0, cells), 1000);
    const s = t.snapshot(1001);
    // 'a' has no cells, so cellIntegral = 0.
    assert.equal(s.players.get('a')?.cellIntegral, 0);
  });

  // ---- observeKills (Catalyst crown) ----

  it('observeKills adds distinct victims', () => {
    const t = new DayTracker();
    t.observe(makeState([player('a', true)]), 1000);
    t.observeKills([
      { killer: 'a', victim: 'v1' },
      { killer: 'a', victim: 'v2' },
    ]);
    const s = t.snapshot(1001);
    assert.equal(s.players.get('a')?.distinctVictims.size, 2);
  });

  it('observeKills deduplicates same victim', () => {
    const t = new DayTracker();
    t.observe(makeState([player('a', true)]), 1000);
    t.observeKills([{ killer: 'a', victim: 'v1' }]);
    t.observeKills([{ killer: 'a', victim: 'v1' }]);
    t.observeKills([{ killer: 'a', victim: 'v1' }]);
    const s = t.snapshot(1001);
    assert.equal(s.players.get('a')?.distinctVictims.size, 1);
  });

  it('observeKills ignores unknown killer', () => {
    const t = new DayTracker();
    t.observe(makeState([player('a', true)]), 1000);
    // Killer 'unknown' not in stats — should be silently ignored.
    t.observeKills([{ killer: 'unknown', victim: 'v1' }]);
    const s = t.snapshot(1001);
    assert.equal(s.players.get('a')?.distinctVictims.size, 0);
  });

  it('observeKills handles empty array', () => {
    const t = new DayTracker();
    t.observe(makeState([player('a', true)]), 1000);
    t.observeKills([]);
    const s = t.snapshot(1001);
    assert.equal(s.players.get('a')?.distinctVictims.size, 0);
  });

  // ---- registerDaemon (Minimalist crown) ----

  it('registerDaemon stores source bytes', () => {
    const t = new DayTracker();
    t.registerDaemon('bot.test@u.h', 512);
    const s = t.snapshot(1000);
    assert.equal(s.daemonSourceBytes.get('bot.test@u.h'), 512);
  });

  it('registerDaemon overwrites existing entry', () => {
    const t = new DayTracker();
    t.registerDaemon('bot.test@u.h', 512);
    t.registerDaemon('bot.test@u.h', 300);
    const s = t.snapshot(1000);
    assert.equal(s.daemonSourceBytes.get('bot.test@u.h'), 300);
  });

  it('registerDaemon supports multiple daemons', () => {
    const t = new DayTracker();
    t.registerDaemon('bot.a@u.h', 100);
    t.registerDaemon('bot.b@u.h', 200);
    const s = t.snapshot(1000);
    assert.equal(s.daemonSourceBytes.size, 2);
  });

  it('finalize includes daemonSourceBytes', () => {
    const t = new DayTracker();
    t.registerDaemon('bot.test@u.h', 777);
    const s = t.finalize(1000);
    assert.equal(s.daemonSourceBytes.get('bot.test@u.h'), 777);
  });

  // ---- Snapshot isolation ----

  it('snapshot clones distinctVictims (mutation isolation)', () => {
    const t = new DayTracker();
    t.observe(makeState([player('a', true)]), 1000);
    t.observeKills([{ killer: 'a', victim: 'v1' }]);
    const s1 = t.snapshot(1001);
    assert.equal(s1.players.get('a')?.distinctVictims.size, 1);
    // Adding more kills after snapshot should not affect the snapshot.
    t.observeKills([{ killer: 'a', victim: 'v2' }]);
    assert.equal(s1.players.get('a')?.distinctVictims.size, 1); // unchanged
    const s2 = t.snapshot(1002);
    assert.equal(s2.players.get('a')?.distinctVictims.size, 2); // new snapshot reflects update
  });

  it('ignores negative score deltas', () => {
    const t = new DayTracker();
    t.observe(makeState([player('a', true, 5)]), 1000);
    t.observe(makeState([player('a', true, 3)]), 1100); // score decreased
    const s = t.finalize(1200);
    assert.equal(s.players.get('a')?.kills, 0);
  });
});
