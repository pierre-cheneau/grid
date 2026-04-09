import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { SessionStats } from '../../src/render/session.js';
import {
  computeAllCrowns,
  computeLastStanding,
  computeMayfly,
  computeReaper,
} from '../../src/stats/crowns.js';
import type { PlayerDayStats } from '../../src/stats/types.js';

function ps(id: string, longestAliveMs: number, kills = 0): PlayerDayStats {
  return { id, longestAliveMs, currentAliveStart: null, kills, lastScore: kills };
}

describe('computeLastStanding', () => {
  it('returns the player with the longest alive streak', () => {
    const stats = new Map([
      ['a', ps('a', 5000)],
      ['b', ps('b', 8000)],
    ]);
    const c = computeLastStanding(stats);
    assert.equal(c?.winnerId, 'b');
    assert.equal(c?.value, 8000);
  });

  it('tie-breaks alphabetically', () => {
    const stats = new Map([
      ['b', ps('b', 5000)],
      ['a', ps('a', 5000)],
    ]);
    assert.equal(computeLastStanding(stats)?.winnerId, 'a');
  });

  it('returns null when no players', () => {
    assert.equal(computeLastStanding(new Map()), null);
  });
});

describe('computeReaper', () => {
  it('returns the player with the most kills', () => {
    const stats = new Map([
      ['a', ps('a', 0, 3)],
      ['b', ps('b', 0, 7)],
    ]);
    const c = computeReaper(stats);
    assert.equal(c?.winnerId, 'b');
    assert.equal(c?.value, 7);
  });

  it('returns null when nobody has kills', () => {
    const stats = new Map([['a', ps('a', 1000, 0)]]);
    assert.equal(computeReaper(stats), null);
  });
});

describe('computeMayfly', () => {
  it('computes the correct session score', () => {
    const session: SessionStats = {
      startedAt: 0,
      deaths: 2,
      derezzes: 3,
      longestRunMs: 20000,
      durationMs: 60000,
      cellsPainted: 100,
    };
    const c = computeMayfly(session, 'me');
    // score = 3 + 20000/10000 + 100/20 = 3 + 2 + 5 = 10
    assert.equal(c.value, 10);
    assert.equal(c.winnerId, 'me');
  });
});

describe('computeReaper (edge cases)', () => {
  it('tie-breaks alphabetically', () => {
    const stats = new Map([
      ['b', ps('b', 0, 5)],
      ['a', ps('a', 0, 5)],
    ]);
    assert.equal(computeReaper(stats)?.winnerId, 'a');
  });
});

describe('computeMayfly (edge cases)', () => {
  it('handles zero activity session', () => {
    const session: SessionStats = {
      startedAt: 0,
      deaths: 0,
      derezzes: 0,
      longestRunMs: 0,
      durationMs: 1000,
      cellsPainted: 0,
    };
    const c = computeMayfly(session, 'me');
    assert.equal(c.value, 0);
  });
});

describe('computeAllCrowns', () => {
  it('returns all applicable crowns', () => {
    const dayStats = {
      players: new Map([
        ['a', ps('a', 10000, 5)],
        ['b', ps('b', 3000, 2)],
      ]),
      peakConcurrent: 2,
      totalKills: 7,
      playerCount: 2,
    };
    const session: SessionStats = {
      startedAt: 0,
      deaths: 1,
      derezzes: 5,
      longestRunMs: 10000,
      durationMs: 30000,
      cellsPainted: 200,
    };
    const crowns = computeAllCrowns(dayStats, session, 'a');
    assert.equal(crowns.length, 3);
    assert.equal(crowns[0]?.crown, 'last-standing');
    assert.equal(crowns[1]?.crown, 'reaper');
    assert.equal(crowns[2]?.crown, 'mayfly');
  });

  it('omits Reaper when no kills', () => {
    const dayStats = {
      players: new Map([['a', ps('a', 5000, 0)]]),
      peakConcurrent: 1,
      totalKills: 0,
      playerCount: 1,
    };
    const session: SessionStats = {
      startedAt: 0,
      deaths: 0,
      derezzes: 0,
      longestRunMs: 5000,
      durationMs: 10000,
      cellsPainted: 50,
    };
    const crowns = computeAllCrowns(dayStats, session, 'a');
    assert.equal(crowns.length, 2); // Last Standing + Mayfly, no Reaper
    assert.ok(crowns.every((c) => c.crown !== 'reaper'));
  });

  it('handles empty day stats', () => {
    const dayStats = {
      players: new Map(),
      peakConcurrent: 0,
      totalKills: 0,
      playerCount: 0,
    };
    const session: SessionStats = {
      startedAt: 0,
      deaths: 0,
      derezzes: 0,
      longestRunMs: 0,
      durationMs: 0,
      cellsPainted: 0,
    };
    const crowns = computeAllCrowns(dayStats, session, 'me');
    // Only Mayfly (always awarded, even with 0 score)
    assert.equal(crowns.length, 1);
    assert.equal(crowns[0]?.crown, 'mayfly');
  });
});
