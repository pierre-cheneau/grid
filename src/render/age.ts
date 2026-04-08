// Age-to-bucket mapping for trail decay rendering.
//
// The simulation removes a cell when its age reaches `2 * halfLifeTicks` (see
// `src/sim/decay.ts`). The renderer splits that lifetime into `DECAY_BUCKETS = 4`
// equal slices and picks one of `GLYPH_TRAIL[0..3]` accordingly.
//
// Bucket math is **pure integer**: no floating point, no platform-dependent rounding.
// `ageFraction` does return a float, but only as input to `fadeColor` which rounds
// back to integer immediately. The simulation never sees either function.

import type { Tick } from '../sim/index.js';
import { DECAY_BUCKETS } from './constants.js';

/**
 * Pick the trail bucket for a cell of age `age` ticks given the configured half-life.
 *
 * Algorithm: split `[0, 2 * halfLifeTicks)` into `DECAY_BUCKETS` equal slices and
 * return the slice index, clamped to `[0, DECAY_BUCKETS - 1]`.
 *
 *   bucket = min(DECAY_BUCKETS - 1, floor(age * DECAY_BUCKETS / (2 * halfLifeTicks)))
 *
 * Returns `0` for the freshest cells, `3` for the oldest. A cell whose age has
 * reached `2 * halfLifeTicks` would already have been removed by the simulation
 * before reaching the renderer; if one slips through (e.g. via a stale snapshot),
 * the clamp keeps it in bucket 3.
 */
export function ageBucket(age: Tick, halfLifeTicks: number): 0 | 1 | 2 | 3 {
  const lifetime = 2 * halfLifeTicks;
  if (lifetime <= 0) return 0;
  if (age <= 0) return 0;
  const idx = Math.floor((age * DECAY_BUCKETS) / lifetime);
  if (idx >= DECAY_BUCKETS - 1) return 3;
  return idx as 0 | 1 | 2 | 3;
}

/**
 * Float in `[0, 1]` representing how much of the trail's lifetime has elapsed.
 *
 * The ONLY float in the entire renderer; consumed exclusively by `fadeColor` in
 * `color.ts` to interpolate the cycle's RGB toward black. The float never re-enters
 * the simulation, so platform-dependent rounding here is purely visual and cannot
 * affect the canonical hash.
 */
export function ageFraction(age: Tick, halfLifeTicks: number): number {
  const lifetime = 2 * halfLifeTicks;
  if (lifetime <= 0) return 0;
  if (age <= 0) return 0;
  if (age >= lifetime) return 1;
  return age / lifetime;
}
