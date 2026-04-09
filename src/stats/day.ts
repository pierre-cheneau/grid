// DayTracker — accumulates per-player stats for crown computation.
//
// Called every tick from the CLI game loop with the current GridState and
// wall-clock time. Tracks alive streaks, kill deltas, and peak concurrency.
// Pure: receives time from caller, no I/O.

import type { GridState, PlayerId } from '../sim/types.js';
import type { DayStats, PlayerDayStats } from './types.js';

export class DayTracker {
  private readonly stats = new Map<PlayerId, PlayerDayStats>();
  private readonly wasAlive = new Map<PlayerId, boolean>();
  private peakConcurrent = 0;
  private totalKills = 0;

  /** Call every tick with the current state and wall-clock time. */
  observe(state: GridState, now: number): void {
    let aliveCount = 0;
    for (const [id, player] of state.players) {
      if (player.isAlive) aliveCount++;

      let ps = this.stats.get(id);
      if (ps === undefined) {
        ps = {
          id,
          longestAliveMs: 0,
          currentAliveStart: player.isAlive ? now : null,
          kills: 0,
          lastScore: player.score,
        };
        this.stats.set(id, ps);
        this.wasAlive.set(id, player.isAlive);
        continue;
      }

      const was = this.wasAlive.get(id) ?? false;

      // Alive → dead: close the current streak.
      if (was && !player.isAlive && ps.currentAliveStart !== null) {
        const run = now - ps.currentAliveStart;
        if (run > ps.longestAliveMs) ps.longestAliveMs = run;
        ps.currentAliveStart = null;
      }

      // Dead → alive: start a new streak.
      if (!was && player.isAlive) {
        ps.currentAliveStart = now;
      }

      // Kill delta from score changes.
      const delta = player.score - ps.lastScore;
      if (delta > 0) {
        ps.kills += delta;
        this.totalKills += delta;
      }
      ps.lastScore = player.score;

      this.wasAlive.set(id, player.isAlive);
    }

    if (aliveCount > this.peakConcurrent) this.peakConcurrent = aliveCount;
  }

  /** Non-destructive snapshot: returns current stats without closing open streaks.
   *  Used at midnight to compute crowns while the session continues. */
  snapshot(now: number): DayStats {
    // Temporarily compute longest alive including the open streak, without mutating.
    const snapped = new Map<PlayerId, PlayerDayStats>();
    for (const [id, ps] of this.stats) {
      let longest = ps.longestAliveMs;
      if (ps.currentAliveStart !== null) {
        const run = now - ps.currentAliveStart;
        if (run > longest) longest = run;
      }
      snapped.set(id, { ...ps, longestAliveMs: longest });
    }
    return {
      players: snapped,
      peakConcurrent: this.peakConcurrent,
      totalKills: this.totalKills,
      playerCount: this.stats.size,
    };
  }

  /** Destructive finalize: closes all open streaks. Use only when the day is done. */
  finalize(now: number): DayStats {
    for (const ps of this.stats.values()) {
      if (ps.currentAliveStart !== null) {
        const run = now - ps.currentAliveStart;
        if (run > ps.longestAliveMs) ps.longestAliveMs = run;
        ps.currentAliveStart = null;
      }
    }
    return {
      players: this.stats,
      peakConcurrent: this.peakConcurrent,
      totalKills: this.totalKills,
      playerCount: this.stats.size,
    };
  }
}
