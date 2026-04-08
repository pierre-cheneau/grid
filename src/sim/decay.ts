// Deterministic age-based trail decay.
//
// A cell is removed when its age (measured in ticks since `createdAtTick`) reaches
// `2 * halfLifeTicks`. There is no probabilistic decay — the half-life is the *expected*
// lifetime label for the user, but the implementation is a hard ceiling at 2x. This
// keeps decay pure integer arithmetic, spends zero PRNG entropy, and is trivial to
// reason about in property tests.
//
// Why a hard ceiling instead of an exponential schedule:
//   - exponential decay needs PRNG entropy, which couples decay to rng state and makes
//     test scenarios harder to author;
//   - the visual effect at 10 tps with `halfLifeTicks=60` (12 seconds total lifetime
//     before removal) is indistinguishable from a probabilistic schedule for the
//     player but is much easier to debug.
//
// Returns a NEW Map. The input is never mutated.

import { sortedEntries } from './iter.js';
import type { Cell, Tick } from './types.js';

/**
 * Drop every cell whose age has reached the decay ceiling.
 *
 * `currentTick` is the tick at which decay is being evaluated (i.e. the tick number
 * of the state being constructed). A cell with `createdAtTick = t` and the player
 * config's `halfLifeTicks = h` survives so long as `currentTick - t < 2 * h`.
 */
export function decayCells(
  cells: ReadonlyMap<string, Cell>,
  currentTick: Tick,
  halfLifeTicks: number,
): Map<string, Cell> {
  const ceiling = 2 * halfLifeTicks;
  const next = new Map<string, Cell>();
  // Sorted iteration: even though Map insertion order doesn't affect canonical bytes
  // (the serializer re-sorts), we still iterate sorted to keep decay observably
  // deterministic if anything ever depends on traversal order.
  for (const [key, cell] of sortedEntries(cells)) {
    const age = currentTick - cell.createdAtTick;
    if (age < ceiling) {
      next.set(key, cell);
    }
  }
  return next;
}
