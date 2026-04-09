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
}

export interface SessionTracker {
  /** Call every tick with the local player's current alive state and score. */
  update(isAlive: boolean, score: number, now: number): void;
  /** Snapshot the final stats. Closes any open alive streak. */
  finalize(now: number): SessionStats;
}

export function createSessionTracker(now: number): SessionTracker {
  const startedAt = now;
  let deaths = 0;
  let lastScore = 0;
  let wasAlive = true;
  let currentRunStart = now;
  let longestRunMs = 0;

  function closeRun(now: number): void {
    const run = now - currentRunStart;
    if (run > longestRunMs) longestRunMs = run;
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
      wasAlive = isAlive;
      lastScore = score;
    },
    finalize(now) {
      if (wasAlive) closeRun(now);
      return {
        startedAt,
        deaths,
        derezzes: lastScore,
        longestRunMs,
        durationMs: now - startedAt,
      };
    },
  };
}
