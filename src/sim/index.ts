// Public API of the simulation core.
//
// External code (CLI, networking, rendering) imports from this file ONLY. Reaching
// into individual modules under `src/sim/` is allowed within the simulation but not
// from the outside.

export { simulateTick } from './tick.js';
export { hashState } from './hash.js';
export { canonicalBytes } from './serialize.js';
export { newRng, cloneRng, nextU32, nextRangeU32, splitmix64 } from './rng.js';
export { cellKey, parseCellKey, inBounds, applyTurn, DIR_DELTA } from './grid.js';
export {
  TICKS_PER_SECOND,
  RESPAWN_TICKS,
  DEFAULT_HALF_LIFE_TICKS,
  TICK_MAX,
  MAX_GRID_DIM,
} from './constants.js';
export type {
  Cell,
  CellAge,
  CellType,
  Config,
  Coord,
  Direction,
  GridState,
  Inputs,
  JoinRequest,
  Player,
  PlayerId,
  Position,
  RngState,
  Tick,
  Turn,
} from './types.js';
