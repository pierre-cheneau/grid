// Crown computation — pure functions that determine daily crown winners.
//
// Six crowns: Last Standing, Reaper, Architect, Catalyst, Mayfly, Minimalist.
// Each rewards a different virtue. See docs/design/goals.md for the full spec.

import type { SessionStats } from '../render/session.js';
import type { PlayerId } from '../sim/types.js';
import type { Crown, DayStats, PlayerDayStats } from './types.js';

function formatDuration(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  return `${min}m ${sec % 60}s`;
}

/** Last Standing: longest continuous alive streak during the day. */
export function computeLastStanding(stats: ReadonlyMap<PlayerId, PlayerDayStats>): Crown | null {
  let best: PlayerDayStats | null = null;
  for (const ps of stats.values()) {
    if (
      ps.longestAliveMs > 0 &&
      (best === null ||
        ps.longestAliveMs > best.longestAliveMs ||
        (ps.longestAliveMs === best.longestAliveMs && ps.id < best.id))
    ) {
      best = ps;
    }
  }
  if (best === null) return null;
  return {
    crown: 'last-standing',
    winnerId: best.id,
    value: best.longestAliveMs,
    label: `Last Standing ${best.id} (${formatDuration(best.longestAliveMs)})`,
  };
}

/** Reaper: most kills during the day (must have at least 1). */
export function computeReaper(stats: ReadonlyMap<PlayerId, PlayerDayStats>): Crown | null {
  let best: PlayerDayStats | null = null;
  for (const ps of stats.values()) {
    if (
      ps.kills > 0 &&
      (best === null || ps.kills > best.kills || (ps.kills === best.kills && ps.id < best.id))
    ) {
      best = ps;
    }
  }
  if (best === null) return null;
  return {
    crown: 'reaper',
    winnerId: best.id,
    value: best.kills,
    label: `Reaper ${best.id} (${best.kills} kills)`,
  };
}

/** Architect: highest cell-tick area integral (sampled). */
export function computeArchitect(stats: ReadonlyMap<PlayerId, PlayerDayStats>): Crown | null {
  let best: PlayerDayStats | null = null;
  for (const ps of stats.values()) {
    if (
      ps.cellIntegral > 0 &&
      (best === null ||
        ps.cellIntegral > best.cellIntegral ||
        (ps.cellIntegral === best.cellIntegral && ps.id < best.id))
    ) {
      best = ps;
    }
  }
  if (best === null) return null;
  return {
    crown: 'architect',
    winnerId: best.id,
    value: best.cellIntegral,
    label: `Architect ${best.id} (${best.cellIntegral} cell-ticks)`,
  };
}

/** Catalyst: most distinct victims killed. Rewards breadth over volume. */
export function computeCatalyst(stats: ReadonlyMap<PlayerId, PlayerDayStats>): Crown | null {
  let best: PlayerDayStats | null = null;
  let bestCount = 0;
  for (const ps of stats.values()) {
    const count = ps.distinctVictims.size;
    if (count > 0 && (count > bestCount || (count === bestCount && ps.id < (best?.id ?? '')))) {
      best = ps;
      bestCount = count;
    }
  }
  if (best === null) return null;
  return {
    crown: 'catalyst',
    winnerId: best.id,
    value: bestCount,
    label: `Catalyst ${best.id} (${bestCount} distinct victims)`,
  };
}

/** Mayfly: best single pilot session score. Local-only.
 *  Formula: derezzes + (longestRunMs / 10000) + cellsPainted / 20 */
export function computeMayfly(session: SessionStats, localId: PlayerId): Crown {
  const score = session.derezzes + session.longestRunMs / 10000 + session.cellsPainted / 20;
  return {
    crown: 'mayfly',
    winnerId: localId,
    value: Math.round(score * 100) / 100,
    label: `Mayfly ${localId} (score ${score.toFixed(1)})`,
  };
}

/** Minimalist: smallest daemon source that placed top-3 in any other crown metric.
 *  Daemon-only. Returns null if no daemon is eligible. */
export function computeMinimalist(
  stats: ReadonlyMap<PlayerId, PlayerDayStats>,
  daemonSourceBytes: ReadonlyMap<PlayerId, number>,
): Crown | null {
  if (daemonSourceBytes.size === 0) return null;

  // Compute top-3 player IDs for each metric.
  const entries = [...stats.values()];
  const top3Ids = new Set<PlayerId>();

  const addTop3 = (sorted: PlayerDayStats[], metric: (ps: PlayerDayStats) => number) => {
    const filtered = sorted.filter((ps) => metric(ps) > 0);
    for (let i = 0; i < Math.min(3, filtered.length); i++) {
      const entry = filtered[i];
      if (entry) top3Ids.add(entry.id);
    }
  };

  addTop3(
    entries.toSorted((a, b) => b.longestAliveMs - a.longestAliveMs || (a.id < b.id ? -1 : 1)),
    (ps) => ps.longestAliveMs,
  );
  addTop3(
    entries.toSorted((a, b) => b.kills - a.kills || (a.id < b.id ? -1 : 1)),
    (ps) => ps.kills,
  );
  addTop3(
    entries.toSorted((a, b) => b.cellIntegral - a.cellIntegral || (a.id < b.id ? -1 : 1)),
    (ps) => ps.cellIntegral,
  );
  addTop3(
    entries.toSorted(
      (a, b) => b.distinctVictims.size - a.distinctVictims.size || (a.id < b.id ? -1 : 1),
    ),
    (ps) => ps.distinctVictims.size,
  );

  // Filter to daemons and find smallest source.
  let bestId: PlayerId | null = null;
  let bestBytes = Number.POSITIVE_INFINITY;
  for (const id of top3Ids) {
    const bytes = daemonSourceBytes.get(id);
    if (
      bytes !== undefined &&
      (bytes < bestBytes || (bytes === bestBytes && id < (bestId ?? '')))
    ) {
      bestId = id;
      bestBytes = bytes;
    }
  }
  if (bestId === null) return null;
  return {
    crown: 'minimalist',
    winnerId: bestId,
    value: bestBytes,
    label: `Minimalist ${bestId} (${bestBytes} bytes)`,
  };
}

/** Compute all six crowns from day stats and session stats. */
export function computeAllCrowns(
  dayStats: DayStats,
  session: SessionStats,
  localId: PlayerId,
): Crown[] {
  const crowns: Crown[] = [];
  const ls = computeLastStanding(dayStats.players);
  if (ls) crowns.push(ls);
  const rp = computeReaper(dayStats.players);
  if (rp) crowns.push(rp);
  const ar = computeArchitect(dayStats.players);
  if (ar) crowns.push(ar);
  const ct = computeCatalyst(dayStats.players);
  if (ct) crowns.push(ct);
  crowns.push(computeMayfly(session, localId));
  const mn = computeMinimalist(dayStats.players, dayStats.daemonSourceBytes);
  if (mn) crowns.push(mn);
  return crowns;
}
