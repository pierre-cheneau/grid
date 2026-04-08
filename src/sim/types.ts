// Public type definitions for the simulation core.
//
// Every type here is integer-valued (or `bigint` for the 64-bit RNG state). No floats.
// All collections are `Map`s keyed by sortable strings; iteration in `src/sim/` MUST go
// through `iter.ts` so that the order is deterministic.
//
// See `docs/engineering/determinism-rules.md` Rule 7 for the bit-width contract.

/** A stable, sortable player identifier. Real ids are `${USER}@${HOSTNAME}`; tests use `p:<name>`. */
export type PlayerId = string;

/** Simulation tick number. `0..TICK_MAX`. Stored as `number` because <=2^32 is exact in IEEE 754. */
export type Tick = number;

/** Cell age in ticks. `0..TICK_MAX`. */
export type CellAge = number;

/** A grid coordinate. Signed 16-bit: `-32768..32767`. */
export type Coord = number;

/** Cardinal direction. `0=N, 1=E, 2=S, 3=W`. Top-left grid origin (+x right, +y down). */
export type Direction = 0 | 1 | 2 | 3;

/** Wire-protocol input code. Empty string is "no-op, continue straight". */
export type Turn = '' | 'L' | 'R' | 'X';

/** Cell type. `'wall'` is reserved for v0.2; only `'trail'` is constructed in stage 1. */
export type CellType = 'trail' | 'wall';

/** A grid position. Both coordinates are `Coord`. */
export interface Position {
  readonly x: Coord;
  readonly y: Coord;
}

/**
 * PCG32 RNG state. The `state` field is mutated in place by `nextU32` for performance.
 * The simulation always clones the rng at the start of `simulateTick` so the caller's
 * copy is never observably mutated.
 */
export interface RngState {
  state: bigint;
}

/** A persistent cell on the grid. Lethal to any cycle that enters it. */
export interface Cell {
  readonly type: CellType;
  readonly ownerId: PlayerId;
  readonly createdAtTick: Tick;
}

/** A cycle (player or daemon) inhabiting the grid. */
export interface Player {
  readonly id: PlayerId;
  readonly pos: Position;
  readonly dir: Direction;
  readonly isAlive: boolean;
  /** When dead, the tick at which the player will respawn. `null` while alive. */
  readonly respawnAtTick: Tick | null;
  /** Number of derezzes credited to this player. u32. */
  readonly score: number;
  /** Stable hash of the owner's identity, used by the renderer for trail color. u32. */
  readonly colorSeed: number;
}

/** Per-arena simulation configuration. Part of the state, gossiped to joiners. */
export interface Config {
  readonly width: number;
  readonly height: number;
  readonly halfLifeTicks: number;
  readonly seed: bigint;
}

/**
 * The complete simulation state at a given tick.
 *
 * Maps are typed as `ReadonlyMap` from outside the simulation; internal helpers may
 * receive a mutable `Map` when they're constructing the next state.
 */
export interface GridState {
  readonly tick: Tick;
  readonly config: Config;
  readonly rng: RngState;
  readonly players: ReadonlyMap<PlayerId, Player>;
  readonly cells: ReadonlyMap<string, Cell>;
}

/** Inputs delivered to `simulateTick` for a single tick. */
export interface Inputs {
  /** Per-player turn input. Missing players default to `''` (no-op). */
  readonly turns: ReadonlyMap<PlayerId, Turn>;
  /** New players arriving this tick. Each gets a fresh spawn cell from the rng. */
  readonly joins: ReadonlyArray<JoinRequest>;
}

/** A request to join the grid as a new player. Processed in `simulateTick` step 5. */
export interface JoinRequest {
  readonly id: PlayerId;
  readonly colorSeed: number;
}
