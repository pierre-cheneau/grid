import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { SessionStats } from '../../src/render/session.js';
import {
  computeAllCrowns,
  computeArchitect,
  computeCatalyst,
  computeLastStanding,
  computeMayfly,
  computeMinimalist,
  computeReaper,
} from '../../src/stats/crowns.js';
import type { DayStats, PlayerDayStats } from '../../src/stats/types.js';

function ps(
  id: string,
  longestAliveMs: number,
  kills = 0,
  cellIntegral = 0,
  distinctVictims: string[] = [],
): PlayerDayStats {
  return {
    id,
    longestAliveMs,
    currentAliveStart: null,
    kills,
    lastScore: kills,
    cellIntegral,
    distinctVictims: new Set(distinctVictims),
  };
}

function dayStats(
  players: Map<string, PlayerDayStats>,
  daemonSourceBytes: Map<string, number> = new Map(),
): DayStats {
  return {
    players,
    peakConcurrent: players.size,
    totalKills: [...players.values()].reduce((s, p) => s + p.kills, 0),
    playerCount: players.size,
    daemonSourceBytes,
  };
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

  it('tie-breaks alphabetically', () => {
    const stats = new Map([
      ['b', ps('b', 0, 5)],
      ['a', ps('a', 0, 5)],
    ]);
    assert.equal(computeReaper(stats)?.winnerId, 'a');
  });
});

describe('computeArchitect', () => {
  it('returns the player with the highest cell integral', () => {
    const stats = new Map([
      ['a', ps('a', 0, 0, 500)],
      ['b', ps('b', 0, 0, 1200)],
    ]);
    const c = computeArchitect(stats);
    assert.equal(c?.winnerId, 'b');
    assert.equal(c?.value, 1200);
  });

  it('returns null when no cells', () => {
    assert.equal(computeArchitect(new Map([['a', ps('a', 1000)]])), null);
  });

  it('tie-breaks alphabetically', () => {
    const stats = new Map([
      ['b', ps('b', 0, 0, 500)],
      ['a', ps('a', 0, 0, 500)],
    ]);
    assert.equal(computeArchitect(stats)?.winnerId, 'a');
  });
});

describe('computeCatalyst', () => {
  it('returns the player with the most distinct victims', () => {
    const stats = new Map([
      ['a', ps('a', 0, 10, 0, ['v1', 'v2'])],
      ['b', ps('b', 0, 3, 0, ['v1', 'v2', 'v3', 'v4'])],
    ]);
    const c = computeCatalyst(stats);
    assert.equal(c?.winnerId, 'b');
    assert.equal(c?.value, 4);
  });

  it('returns null when no kills', () => {
    assert.equal(computeCatalyst(new Map([['a', ps('a', 1000)]])), null);
  });

  it('tie-breaks alphabetically', () => {
    const stats = new Map([
      ['b', ps('b', 0, 0, 0, ['v1'])],
      ['a', ps('a', 0, 0, 0, ['v2'])],
    ]);
    assert.equal(computeCatalyst(stats)?.winnerId, 'a');
  });
});

describe('computeCatalyst (edge cases)', () => {
  it('single victim counted as 1', () => {
    const stats = new Map([['a', ps('a', 0, 0, 0, ['v1'])]]);
    const c = computeCatalyst(stats);
    assert.equal(c?.value, 1);
  });

  it('all players with empty distinctVictims returns null', () => {
    const stats = new Map([
      ['a', ps('a', 5000, 3)],
      ['b', ps('b', 3000, 1)],
    ]);
    assert.equal(computeCatalyst(stats), null);
  });
});

describe('computeMinimalist', () => {
  it('picks the smallest daemon in top-3 of any metric', () => {
    const stats = new Map([
      ['bot.big@u.h', ps('bot.big@u.h', 10000, 5, 800, ['v1', 'v2'])],
      ['bot.small@u.h', ps('bot.small@u.h', 9000, 4, 600, ['v1'])],
      ['pilot@u.h', ps('pilot@u.h', 8000, 3, 400)],
    ]);
    const bytes = new Map([
      ['bot.big@u.h', 2000],
      ['bot.small@u.h', 500],
    ]);
    const c = computeMinimalist(stats, bytes);
    assert.equal(c?.winnerId, 'bot.small@u.h');
    assert.equal(c?.value, 500);
  });

  it('returns null when no daemons', () => {
    const stats = new Map([['pilot@u.h', ps('pilot@u.h', 10000)]]);
    assert.equal(computeMinimalist(stats, new Map()), null);
  });

  it('returns null when daemon is not in top-3 of any metric', () => {
    const stats = new Map([
      ['a@h', ps('a@h', 10000, 10, 1000, ['v1', 'v2', 'v3'])],
      ['b@h', ps('b@h', 9000, 9, 900, ['v1', 'v2'])],
      ['c@h', ps('c@h', 8000, 8, 800, ['v1'])],
      ['bot.d@u.h', ps('bot.d@u.h', 100, 0, 10)], // too low for top 3
    ]);
    const bytes = new Map([['bot.d@u.h', 200]]);
    assert.equal(computeMinimalist(stats, bytes), null);
  });

  it('daemon in top-3 of ONE metric is eligible', () => {
    const stats = new Map([
      ['a@h', ps('a@h', 10000)],
      ['b@h', ps('b@h', 9000)],
      ['bot.c@u.h', ps('bot.c@u.h', 8000)], // 3rd in Last Standing
    ]);
    const bytes = new Map([['bot.c@u.h', 300]]);
    const c = computeMinimalist(stats, bytes);
    assert.equal(c?.winnerId, 'bot.c@u.h');
  });

  it('two daemons same byte count — tiebreak alphabetically', () => {
    const stats = new Map([
      ['bot.a@u.h', ps('bot.a@u.h', 10000, 5)],
      ['bot.b@u.h', ps('bot.b@u.h', 9000, 4)],
    ]);
    const bytes = new Map([
      ['bot.a@u.h', 500],
      ['bot.b@u.h', 500],
    ]);
    const c = computeMinimalist(stats, bytes);
    assert.equal(c?.winnerId, 'bot.a@u.h'); // 'a' < 'b'
  });

  it('empty stats with empty daemon bytes returns null', () => {
    assert.equal(computeMinimalist(new Map(), new Map()), null);
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
    assert.equal(c.value, 10);
    assert.equal(c.winnerId, 'me');
  });

  it('handles zero activity session', () => {
    const session: SessionStats = {
      startedAt: 0,
      deaths: 0,
      derezzes: 0,
      longestRunMs: 0,
      durationMs: 1000,
      cellsPainted: 0,
    };
    assert.equal(computeMayfly(session, 'me').value, 0);
  });
});

describe('computeAllCrowns', () => {
  it('returns all applicable crowns', () => {
    const ds = dayStats(
      new Map([
        ['a', ps('a', 10000, 5, 200, ['b'])],
        ['b', ps('b', 3000, 2, 100)],
      ]),
    );
    const session: SessionStats = {
      startedAt: 0,
      deaths: 1,
      derezzes: 5,
      longestRunMs: 10000,
      durationMs: 30000,
      cellsPainted: 200,
    };
    const crowns = computeAllCrowns(ds, session, 'a');
    const ids = crowns.map((c) => c.crown);
    assert.ok(ids.includes('last-standing'));
    assert.ok(ids.includes('reaper'));
    assert.ok(ids.includes('architect'));
    assert.ok(ids.includes('catalyst'));
    assert.ok(ids.includes('mayfly'));
  });

  it('handles empty day stats (only Mayfly)', () => {
    const ds = dayStats(new Map());
    const session: SessionStats = {
      startedAt: 0,
      deaths: 0,
      derezzes: 0,
      longestRunMs: 0,
      durationMs: 0,
      cellsPainted: 0,
    };
    const crowns = computeAllCrowns(ds, session, 'me');
    assert.equal(crowns.length, 1);
    assert.equal(crowns[0]?.crown, 'mayfly');
  });

  it('includes Minimalist when daemons exist in top-3', () => {
    const ds = dayStats(
      new Map([
        ['bot.d@u.h', ps('bot.d@u.h', 10000, 5, 200, ['v1'])],
        ['pilot@u.h', ps('pilot@u.h', 3000, 2, 100)],
      ]),
      new Map([['bot.d@u.h', 500]]),
    );
    const session: SessionStats = {
      startedAt: 0,
      deaths: 1,
      derezzes: 2,
      longestRunMs: 3000,
      durationMs: 10000,
      cellsPainted: 50,
    };
    const crowns = computeAllCrowns(ds, session, 'pilot@u.h');
    const ids = crowns.map((c) => c.crown);
    assert.ok(ids.includes('minimalist'));
  });
});
