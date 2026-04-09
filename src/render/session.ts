// Session stats tracker for the exit epitaph.
//
// Observes isAlive transitions from the CLI tick loop. The simulation doesn't
// track death count or longest run — those are presentation concerns. This
// tracker is a tiny state machine driven by per-tick updates.

export interface SessionStats {
  readonly startedAt: number;
  readonly deaths: number;
  readonly derezzes: number;
  readonly longestRunMs: number;
  readonly durationMs: number;
  /** Number of ticks the player was alive ≈ cells deposited. */
  readonly cellsPainted: number;
}

export interface SessionTracker {
  /** Call every tick with the local player's current alive state and score. */
  update(isAlive: boolean, score: number, now: number): void;
  /** Snapshot stats without closing the current alive streak (non-destructive). */
  snapshot(now: number): SessionStats;
  /** Finalize stats, closing any open alive streak (destructive). */
  finalize(now: number): SessionStats;
}

export function createSessionTracker(now: number): SessionTracker {
  const startedAt = now;
  let deaths = 0;
  let lastScore = 0;
  let wasAlive = true;
  let currentRunStart = now;
  let longestRunMs = 0;
  let cellsPainted = 0;

  function currentLongest(now: number): number {
    if (wasAlive) {
      const run = now - currentRunStart;
      return run > longestRunMs ? run : longestRunMs;
    }
    return longestRunMs;
  }

  function closeRun(now: number): void {
    const run = now - currentRunStart;
    if (run > longestRunMs) longestRunMs = run;
  }

  function buildStats(now: number, longest: number): SessionStats {
    return {
      startedAt,
      deaths,
      derezzes: lastScore,
      longestRunMs: longest,
      durationMs: now - startedAt,
      cellsPainted,
    };
  }

  return {
    update(isAlive, score, now) {
      if (wasAlive && !isAlive) {
        deaths++;
        closeRun(now);
      }
      if (!wasAlive && isAlive) {
        currentRunStart = now;
      }
      if (isAlive) cellsPainted++;
      wasAlive = isAlive;
      lastScore = score;
    },
    snapshot(now) {
      return buildStats(now, currentLongest(now));
    },
    finalize(now) {
      if (wasAlive) closeRun(now);
      return buildStats(now, longestRunMs);
    },
  };
}
