// Simulation constants. Pure values, no logic. Imported across the simulation core.
//
// All numbers here are integer-valued and chosen so that the simulation can be
// reproduced byte-for-byte across machines and language ports.

/** Number of simulation ticks per real-time second. */
export const TICKS_PER_SECOND = 10;

/** Ticks between a cycle's derez and its respawn (3 seconds at 10 tps). */
export const RESPAWN_TICKS = 30;

/** Maximum value of a Coord. The grid is never larger than this in either dimension. */
export const MAX_GRID_DIM = 32767;

/** Maximum value of a Tick. Validated on every increment to catch overflow. */
export const TICK_MAX = 0xff_ff_ff_ff;

/** Default trail half-life in ticks (60 seconds at 10 tps). Configurable per arena. */
export const DEFAULT_HALF_LIFE_TICKS = 600;

/** Number of cardinal directions (N, E, S, W). */
export const DIRECTION_COUNT = 4;
