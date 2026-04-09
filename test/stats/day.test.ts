import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { newRng } from '../../src/sim/rng.js';
import type { GridState, Player } from '../../src/sim/types.js';
import { DayTracker } from '../../src/stats/day.js';

const cfg = { width: 16, height: 16, halfLifeTicks: 30, seed: 0n, circular: false };

function makeState(players: Player[], tick = 0): GridState {
  const map = new Map(players.map((p) => [p.id, p]));
  return { tick, config: cfg, rng: newRng(0n), players: map, cells: new Map() };
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
});
