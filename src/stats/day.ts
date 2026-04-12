// DayTracker — accumulates per-player stats for crown computation.
//
// Called every tick from the CLI game loop with the current GridState and
// wall-clock time. Tracks alive streaks, kill deltas, and peak concurrency.
// Pure: receives time from caller, no I/O.

import type { GridState, PlayerId } from '../sim/types.js';
import type { DayStats, PlayerDayStats } from './types.js';

/** Cell integral sampling interval in ticks (~1s at 10 tps). */
const CELL_SAMPLE_INTERVAL = 10;

export class DayTracker {
  private readonly stats = new Map<PlayerId, PlayerDayStats>();
  private readonly wasAlive = new Map<PlayerId, boolean>();
  private readonly daemonBytes = new Map<PlayerId, number>();
  private peakConcurrent = 0;
  private totalKills = 0;
  private lastCellSampleTick = -CELL_SAMPLE_INTERVAL;

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
          cellIntegral: 0,
          distinctVictims: new Set(),
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

    // Cell integral sampling: count cells per owner periodically.
    if (state.tick - this.lastCellSampleTick >= CELL_SAMPLE_INTERVAL) {
      this.lastCellSampleTick = state.tick;
      for (const cell of state.cells.values()) {
        const ps = this.stats.get(cell.ownerId);
        if (ps !== undefined) ps.cellIntegral += CELL_SAMPLE_INTERVAL;
      }
    }
  }

  /** Record killer→victim pairs for the Catalyst crown. */
  observeKills(kills: ReadonlyArray<{ killer: PlayerId; victim: PlayerId }>): void {
    for (const { killer, victim } of kills) {
      const ps = this.stats.get(killer);
      if (ps) ps.distinctVictims.add(victim);
    }
  }

  /** Register a daemon's source byte count for the Minimalist crown. */
  registerDaemon(id: PlayerId, sourceBytes: number): void {
    this.daemonBytes.set(id, sourceBytes);
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
      snapped.set(id, {
        ...ps,
        longestAliveMs: longest,
        distinctVictims: new Set(ps.distinctVictims),
      });
    }
    return {
      players: snapped,
      peakConcurrent: this.peakConcurrent,
      totalKills: this.totalKills,
      playerCount: this.stats.size,
      daemonSourceBytes: new Map(this.daemonBytes),
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
      daemonSourceBytes: this.daemonBytes,
    };
  }
}
