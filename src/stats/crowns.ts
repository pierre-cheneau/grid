// Crown computation — pure functions that determine daily crown winners.
//
// v0.1 computes three crowns: Last Standing, Reaper, and Mayfly.
// Architect and Catalyst are deferred to v0.2 (require per-tick cell integrals
// and causal chain analysis). Minimalist is daemon-only (no daemons in v0.1).

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

/** Mayfly: best single pilot session score. Local-only in v0.1.
 *  Formula: derezzes + (longestRunMs / 10000) + cellsPainted / 20 */
/** Mayfly: always awarded (even with zero score) because it's the pilot's
 *  crown — every pilot session has a score, and seeing it motivates return. */
export function computeMayfly(session: SessionStats, localId: PlayerId): Crown {
  const score = session.derezzes + session.longestRunMs / 10000 + session.cellsPainted / 20;
  return {
    crown: 'mayfly',
    winnerId: localId,
    value: Math.round(score * 100) / 100,
    label: `Mayfly ${localId} (score ${score.toFixed(1)})`,
  };
}

/** Compute all v0.1 crowns from day stats and session stats. */
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
  crowns.push(computeMayfly(session, localId));
  return crowns;
}
