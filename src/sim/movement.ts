// Cycle movement and collision resolution.
//
// This is the heart of the lockstep simulation. Every collision rule is decided here
// and every rule must be sort-stable: two simulators receiving the same prior state and
// the same input set MUST resolve identical winners and losers, regardless of how the
// underlying Maps were built. The only iteration helper used here is `sortedEntries`.
//
// Collision rules, in the exact order they are applied:
//   1. OUT-OF-BOUNDS — a cycle whose target cell is outside the grid dies.
//   2. EXISTING-CELL — a cycle whose target cell is occupied by an existing trail dies.
//                      The trail's `ownerId` is awarded one kill credit.
//   3. HEAD-ON       — two cycles targeting the same cell both die.
//   4. SWAP          — two cycles whose target is the other's prior position both die.
//
// All rules are evaluated against the *prior* state. Survivors deposit a trail at
// their PREVIOUS position (the cell they're leaving) — done by the caller after
// `resolveMoves` returns.
//
// Returns: a `MoveResolution` describing each player's outcome. The caller composes
// the new state from this resolution.

import { DIR_DELTA, cellKey, inBounds } from './grid.js';
import { sortedEntries } from './iter.js';
import type { Cell, Config, Player, PlayerId, Position } from './types.js';

/** Per-player outcome for a single tick. */
export interface PlayerMove {
  readonly player: Player;
  readonly from: Position;
  /** Where the cycle WANTED to go this tick (`from + DIR_DELTA[dir]`). */
  readonly to: Position;
  readonly survived: boolean;
  /** If `survived === false`, the player id awarded the kill (or null for env deaths). */
  readonly killedBy: PlayerId | null;
}

export interface MoveResolution {
  readonly moves: ReadonlyMap<PlayerId, PlayerMove>;
}

/**
 * Compute and resolve all moves for the alive players in `players` against `cells`.
 *
 * Pure: neither input is mutated.
 */
export function resolveMoves(
  cfg: Config,
  players: ReadonlyMap<PlayerId, Player>,
  cells: ReadonlyMap<string, Cell>,
): MoveResolution {
  // Step A: build the prospective move list, sorted by player id for determinism.
  // Dead players (waiting to respawn) are skipped — they don't move.
  const proposed: PlayerMove[] = [];
  for (const [, player] of sortedEntries(players)) {
    if (!player.isAlive) continue;
    const [dx, dy] = DIR_DELTA[player.dir] as readonly [number, number];
    const to: Position = { x: player.pos.x + dx, y: player.pos.y + dy };
    proposed.push({
      player,
      from: player.pos,
      to,
      survived: true,
      killedBy: null,
    });
  }

  // Step B: apply collision rules in order. Mutate the local move objects, then
  // freeze them into the result map.
  const work: PlayerMove[] = proposed.map((m) => ({ ...m }));

  // Rule 1: out-of-bounds.
  for (const m of work) {
    if (!m.survived) continue;
    if (!inBounds(cfg, m.to.x, m.to.y)) {
      mutate(m, { survived: false, killedBy: null });
    }
  }

  // Rule 2: existing trail collision. The trail's owner gets the credit.
  for (const m of work) {
    if (!m.survived) continue;
    const key = cellKey(m.to.x, m.to.y);
    const trail = cells.get(key);
    if (trail !== undefined) {
      mutate(m, { survived: false, killedBy: trail.ownerId });
    }
  }

  // Rule 3: head-on. Two or more survivors targeting the same cell all die.
  // No kill credit (mutual destruction with no clear winner).
  const targetCounts = new Map<string, number>();
  for (const m of work) {
    if (!m.survived) continue;
    const key = cellKey(m.to.x, m.to.y);
    targetCounts.set(key, (targetCounts.get(key) ?? 0) + 1);
  }
  for (const m of work) {
    if (!m.survived) continue;
    const key = cellKey(m.to.x, m.to.y);
    if ((targetCounts.get(key) ?? 0) > 1) {
      mutate(m, { survived: false, killedBy: null });
    }
  }

  // Rule 4: swap. A targets B's prior position AND B targets A's prior position.
  // Index by `from` for O(n) lookup. Iterate sorted to keep the assignment order
  // canonical (matters only if a future debug invariant logs the order).
  const fromIndex = new Map<string, PlayerMove>();
  for (const m of work) {
    if (!m.survived) continue;
    fromIndex.set(cellKey(m.from.x, m.from.y), m);
  }
  for (const m of work) {
    if (!m.survived) continue;
    const targetKey = cellKey(m.to.x, m.to.y);
    const other = fromIndex.get(targetKey);
    if (other === undefined || other === m) continue;
    if (
      other.from.x === m.to.x &&
      other.from.y === m.to.y &&
      other.to.x === m.from.x &&
      other.to.y === m.from.y
    ) {
      mutate(m, { survived: false, killedBy: null });
      mutate(other, { survived: false, killedBy: null });
    }
  }

  // Step C: pack into a map keyed by player id.
  const moves = new Map<PlayerId, PlayerMove>();
  for (const m of work) {
    moves.set(m.player.id, m);
  }
  return { moves };
}

/** Tiny helper that lets us pretend `PlayerMove` is mutable inside this module. */
function mutate(m: PlayerMove, patch: Partial<PlayerMove>): void {
  Object.assign(m, patch);
}
