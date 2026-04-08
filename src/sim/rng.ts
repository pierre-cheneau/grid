// PCG32 random number generator, vendored.
//
// Why vendored: the eventual Python port (and any third language) must produce
// bit-identical sequences from the same seed. Pinning a third-party RNG library means
// pinning *their* version, on every platform, forever. Vendoring 30 lines is cheaper.
//
// Algorithm: Melissa O'Neill's PCG32 with a fixed increment. Reference test vectors
// for `seed=0` and `seed=42` are pinned in `test/sim/rng.test.ts` — those tests are
// the cross-port contract.
//
// Seeding: `splitmix64` is used to derive the initial PCG state from a user-provided
// 64-bit seed. This is the same convention used by xoshiro and most modern PRNGs.

import type { RngState } from './types.js';

const PCG_MULT = 6364136223846793005n;
const PCG_INC = 1442695040888963407n;
const MASK_32 = 0xff_ff_ff_ffn;
const MASK_64 = 0xff_ff_ff_ff_ff_ff_ff_ffn;

/** Standard splitmix64 step. Used to whiten a user seed before feeding PCG32. */
export function splitmix64(seed: bigint): bigint {
  let z = (seed + 0x9e3779b97f4a7c15n) & MASK_64;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK_64;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK_64;
  return (z ^ (z >> 31n)) & MASK_64;
}

/** Construct a fresh RNG from a 64-bit seed. */
export function newRng(seed: bigint): RngState {
  return { state: splitmix64(seed) };
}

/** Return a copy of `rng` whose mutations do not affect the original. */
export function cloneRng(rng: RngState): RngState {
  return { state: rng.state };
}

/**
 * Advance the RNG and return the next 32-bit unsigned integer.
 * Mutates `rng.state` in place — callers that need purity must `cloneRng` first.
 */
export function nextU32(rng: RngState): number {
  const oldstate = rng.state;
  rng.state = (oldstate * PCG_MULT + PCG_INC) & MASK_64;
  const xorshifted = Number((((oldstate >> 18n) ^ oldstate) >> 27n) & MASK_32);
  const rot = Number(oldstate >> 59n) & 31;
  // ((xorshifted >>> rot) | (xorshifted << ((-rot) & 31))) >>> 0
  const right = xorshifted >>> rot;
  const left = (xorshifted << (-rot & 31)) >>> 0;
  return (right | left) >>> 0;
}

/**
 * Return an unbiased integer in `[0, max)`.
 *
 * Uses Lemire's nearly-divisionless bounded method (integer arithmetic only, no floats).
 * `max` must be a positive integer in `[1, 2^32]`. Throws otherwise — programming error.
 */
export function nextRangeU32(rng: RngState, max: number): number {
  if (!Number.isInteger(max) || max <= 0 || max > 0x1_00_00_00_00) {
    throw new Error(`nextRangeU32: max out of range: ${max}`);
  }
  // Lemire's method, BigInt edition. Cheap, unbiased, and avoids any 32x32->64 mul tricks.
  const maxBig = BigInt(max);
  while (true) {
    const x = BigInt(nextU32(rng));
    const m = x * maxBig;
    const l = m & MASK_32;
    if (l < maxBig) {
      const t = (-maxBig & MASK_32) % maxBig;
      if (l < t) continue;
    }
    return Number(m >> 32n);
  }
}
