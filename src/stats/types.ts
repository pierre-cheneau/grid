// Types for daily stat accumulation and crown computation.
// Pure data definitions — no logic.

import type { PlayerId } from '../sim/types.js';

/** Per-player stats accumulated throughout the day. */
export interface PlayerDayStats {
  readonly id: PlayerId;
  /** Longest continuous alive period in ms (wall-clock). For Last Standing. */
  longestAliveMs: number;
  /** Current alive streak start timestamp, or null if dead. */
  currentAliveStart: number | null;
  /** Total kills (from player.score deltas). For Reaper. */
  kills: number;
  /** Last observed score — used to compute kill deltas. */
  lastScore: number;
}

/** Identifiers for the crowns computed in v0.1. */
export type CrownId = 'last-standing' | 'reaper' | 'mayfly';

/** A crown awarded to a player for the day. */
export interface Crown {
  readonly crown: CrownId;
  readonly winnerId: PlayerId;
  readonly value: number;
  readonly label: string;
}

/** Finalized day stats returned by DayTracker. */
export interface DayStats {
  readonly players: ReadonlyMap<PlayerId, PlayerDayStats>;
  readonly peakConcurrent: number;
  readonly totalKills: number;
  readonly playerCount: number;
}
