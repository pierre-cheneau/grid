// Tile coordinate math and CRDT merge for cell maps.
//
// The world is divided into fixed-size tiles (256×256 cells). Each tile maps
// to a Nostr topic for cell snapshot publication and subscription. At current
// scale (250×250 world), there is exactly 1 tile — the code handles N tiles
// trivially.
//
// The CRDT merge is a Grow-Only Set with TTL: union of cell sets, latest
// createdAtTick wins per position. Commutative, associative, idempotent.

import { parseCellKey } from '../sim/grid.js';
import type { Cell } from '../sim/types.js';

/** Tile size in cells (each axis). */
export const TILE_SIZE = 256;

/** Compute the tile coordinates for a cell position. */
export function tileCoords(x: number, y: number): { tileX: number; tileY: number } {
  return { tileX: Math.floor(x / TILE_SIZE), tileY: Math.floor(y / TILE_SIZE) };
}

/** Compute all tile coordinates covering a world of the given dimensions. */
export function worldTiles(width: number, height: number): Array<{ tileX: number; tileY: number }> {
  const cols = Math.ceil(width / TILE_SIZE);
  const rows = Math.ceil(height / TILE_SIZE);
  const tiles: Array<{ tileX: number; tileY: number }> = [];
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      tiles.push({ tileX: tx, tileY: ty });
    }
  }
  return tiles;
}

export interface TilePartition {
  readonly tileX: number;
  readonly tileY: number;
  readonly cells: Map<string, Cell>;
}

/** Partition a cell map into per-tile groups, each with explicit coordinates. */
export function partitionByTile(cells: ReadonlyMap<string, Cell>): TilePartition[] {
  const byKey = new Map<string, TilePartition>();
  for (const [key, cell] of cells) {
    const { x, y } = parseCellKey(key);
    const { tileX, tileY } = tileCoords(x, y);
    const tileKey = `${tileX}-${tileY}`;
    let tile = byKey.get(tileKey);
    if (tile === undefined) {
      tile = { tileX, tileY, cells: new Map() };
      byKey.set(tileKey, tile);
    }
    tile.cells.set(key, cell);
  }
  return [...byKey.values()];
}

/** CRDT merge: union of two cell maps, latest createdAtTick wins per key.
 *  When ticks are equal, `a` has priority (deterministic). */
export function mergeCellMaps(
  a: ReadonlyMap<string, Cell>,
  b: ReadonlyMap<string, Cell>,
): Map<string, Cell> {
  const result = new Map(a);
  for (const [key, cell] of b) {
    const existing = result.get(key);
    if (existing === undefined || cell.createdAtTick > existing.createdAtTick) {
      result.set(key, cell);
    }
  }
  return result;
}
