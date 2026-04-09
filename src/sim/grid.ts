// Grid coordinate helpers and direction arithmetic.
//
// Cell key encoding: `padHex4(y) + padHex4(x)`. Since both halves are fixed-width
// uppercase hex, lexicographic ordering on the key string equals row-major (y, x)
// ordering on the cells. This is what `architecture/determinism.md` requires for the
// canonical hash.
//
// All coordinates are stored as non-negative integers in stage 1 (the grid lives in
// `[0, width) x [0, height)`). The 16-bit signed Coord type leaves room for negative
// values in future versions without changing the encoding.

import type { Config, Direction, Turn } from './types.js';

/** Cardinal-direction unit vectors. Indexed by `Direction`. Top-left origin. */
export const DIR_DELTA: ReadonlyArray<readonly [number, number]> = [
  [0, -1], // 0 = N
  [1, 0], // 1 = E
  [0, 1], // 2 = S
  [-1, 0], // 3 = W
] as const;

/** Format a single u16 coordinate as a 4-character uppercase hex string. */
function padHex4(n: number): string {
  // We rely on the caller passing a valid coordinate; the boundary check happens
  // when the position is constructed, not on every cellKey call (hot path).
  return (n & 0xff_ff).toString(16).toUpperCase().padStart(4, '0');
}

/** Encode a cell position as the canonical map key. Sort order = row-major (y, x). */
export function cellKey(x: number, y: number): string {
  return padHex4(y) + padHex4(x);
}

/** Decode a cell key back into its (x, y) position. Inverse of `cellKey`. */
export function parseCellKey(key: string): { x: number; y: number } {
  if (key.length !== 8) {
    throw new Error(`parseCellKey: expected 8-char key, got ${key.length}: ${key}`);
  }
  const y = Number.parseInt(key.slice(0, 4), 16);
  const x = Number.parseInt(key.slice(4, 8), 16);
  return { x, y };
}

/** Returns true iff (x, y) lies inside the playable area defined by `cfg`.
 *  When `cfg.circular` is true, the area is a circle inscribed in the bounding
 *  rectangle. All math is integer — centers are doubled to avoid 0.5. */
export function inBounds(cfg: Config, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= cfg.width || y >= cfg.height) return false;
  if (!cfg.circular) return true;
  // Circle inscribed in width×height. Diameter = min(width, height).
  const dx = 2 * x - (cfg.width - 1);
  const dy = 2 * y - (cfg.height - 1);
  const d = Math.min(cfg.width, cfg.height);
  return dx * dx + dy * dy <= d * d;
}

/**
 * Apply a turn input to a current direction.
 *
 * - `''` keeps the current direction.
 * - `'L'` rotates counter-clockwise: N→W→S→E→N.
 * - `'R'` rotates clockwise:        N→E→S→W→N.
 * - `'X'` is the wire-level "exit" input and is treated as a no-op here. The exit
 *   itself is processed by `simulateTick` step 4 (player removal); by the time we
 *   reach the turn-application step, all `'X'` inputs have already been consumed.
 */
export function applyTurn(dir: Direction, turn: Turn): Direction {
  switch (turn) {
    case 'L':
      return ((dir + 3) % 4) as Direction;
    case 'R':
      return ((dir + 1) % 4) as Direction;
    case '':
    case 'X':
      return dir;
  }
}
