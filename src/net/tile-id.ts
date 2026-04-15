// TileId — a tile coordinate in the Living Mosaic.
//
// The world is partitioned into TILE_SIZE × TILE_SIZE tiles. Each tile is
// identified by integer (x, y) coordinates where (0, 0) covers world cells
// (0..TILE_SIZE-1, 0..TILE_SIZE-1). Tile coordinates can be negative for
// completeness, though practical worlds use non-negative positions only.
//
// Pure types and functions, no I/O. Used by NostrRoom and PresenceTracker
// to scope subscriptions to a single tile (Stage 13). Stage 14+ will use
// TileId for shadow-zone membership and cross-tile transitions.

import { TILE_SIZE, tileCoords } from '../persist/tile.js';
import type { Position } from '../sim/types.js';

/** A tile coordinate. (0, 0) is the top-left tile of the world. */
export interface TileId {
  readonly x: number;
  readonly y: number;
}

/** Compute the tile containing a given world position. */
export function tileOfPos(pos: Position): TileId {
  const { tileX, tileY } = tileCoords(pos.x, pos.y);
  return { x: tileX, y: tileY };
}

/** Stable string key for a TileId. Used as Map keys and in Nostr tag values
 *  (`grid:DAY:t:X-Y`). The format mirrors Stage 9's cell-snapshot tag. */
export function tileKeyOf(tile: TileId): string {
  return `${tile.x}-${tile.y}`;
}

/** Equality check for TileIds. */
export function tileEq(a: TileId, b: TileId): boolean {
  return a.x === b.x && a.y === b.y;
}

/** Re-exported for convenience. Tile dimensions are defined once in src/persist/tile.ts. */
export { TILE_SIZE };
