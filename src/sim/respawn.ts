// Respawn helpers.
//
// Spawn cell selection is the only place in stage 1 where the simulation consumes RNG
// entropy. The algorithm is rejection sampling: pick a random (x, y) in the grid, and
// retry if it's already occupied by a trail or by a live cycle. This is unbiased and
// trivially deterministic — same rng state in, same cell out.
//
// In a fully populated grid this could loop forever; in stage 1 the grid is always far
// from full, so we cap retries at a generous constant and throw on overflow (which is
// a programming error, not a runtime condition we expect to handle).

import { cellKey, inBounds } from './grid.js';
import { sortedEntries } from './iter.js';
import { nextRangeU32 } from './rng.js';
import type { Cell, Config, Player, PlayerId, Position, RngState } from './types.js';

const MAX_SPAWN_ATTEMPTS = 1000;

/** Pick a free cell at random. Mutates `rng`. */
export function pickSpawnCell(
  cfg: Config,
  cells: ReadonlyMap<string, Cell>,
  players: ReadonlyMap<PlayerId, Player>,
  rng: RngState,
): Position {
  // Build a fast occupancy lookup of live-player positions. We don't need to sort it
  // because we only test membership.
  const occupied = new Set<string>();
  for (const [, player] of sortedEntries(players)) {
    if (player.isAlive) occupied.add(cellKey(player.pos.x, player.pos.y));
  }
  for (let attempt = 0; attempt < MAX_SPAWN_ATTEMPTS; attempt++) {
    const x = nextRangeU32(rng, cfg.width);
    const y = nextRangeU32(rng, cfg.height);
    if (!inBounds(cfg, x, y)) continue;
    const key = cellKey(x, y);
    if (cells.has(key)) continue;
    if (occupied.has(key)) continue;
    return { x, y };
  }
  throw new Error('pickSpawnCell: grid is full or near-full; increase grid size');
}
