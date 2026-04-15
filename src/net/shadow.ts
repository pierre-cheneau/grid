// Shadow zone computation — which tiles a position overlaps with.
//
// A player at position P is "primary" in the tile containing P, and
// "shadowed" in every adjacent tile T where the Chebyshev distance from
// P to T's nearest edge is less than SHADOW_ZONE_WIDTH. Shadow tiles
// are the domain of multi-mesh participation: a shadowed peer is in
// BOTH its primary tile's mesh and each shadow tile's mesh.
//
// This module is pure: no I/O, no state. The caller owns the
// decision of what to DO with the shadow set (subscribe, connect,
// simulate). Stage 14a establishes the geometry; Stage 14b activates
// the multi-mesh runtime.

import type { Position } from '../sim/types.js';
import { TILE_SIZE, type TileId } from './tile-id.js';

/** Optional world bounds to clip the shadow set at the world edge.
 *  When provided, shadow tiles outside `[minTile..maxTile]` (inclusive on
 *  both ends) are excluded from the result. */
export interface WorldBounds {
  readonly minTile: TileId;
  readonly maxTile: TileId;
}

/** Compute the set of tiles a position belongs to:
 *  - Always includes the primary tile (the one containing the position).
 *  - Additionally includes each of the 8 neighboring tiles for which the
 *    position is within `shadowWidth` cells of the shared border.
 *
 *  The returned array has a deterministic order that is a public contract
 *  of the function: primary first, then orthogonal neighbors (W, E, N, S),
 *  then diagonal neighbors (NW, NE, SW, SE). Callers (notably Stage 14b's
 *  mesh lifecycle diff) may depend on `primary` being at index 0.
 *
 *  Preconditions:
 *  - `pos.x`, `pos.y` must be finite numbers. Fractional values are
 *    floored internally (GRID's `Coord` type is conceptually int16, but
 *    the flooring is defensive against any caller that passes floats).
 *  - `tileSize > 0`.
 *  - If `bounds` is provided, `minTile.x ≤ maxTile.x` and similarly for y.
 *
 *  @param pos          World-space position.
 *  @param shadowWidth  Shadow zone depth in cells. Values ≤ 0 disable
 *                      shadowing (only primary returned). Values ≥ `tileSize`
 *                      effectively include all 8 neighbors.
 *  @param tileSize     Cells per tile axis. Defaults to `TILE_SIZE`.
 *  @param bounds       Optional world bounds for clipping. */
export function shadowTilesOf(
  pos: Position,
  shadowWidth: number,
  tileSize: number = TILE_SIZE,
  bounds?: WorldBounds,
): TileId[] {
  // Normalize to integer coords. Position.{x,y} is conceptually int16 in
  // GRID's type system, but `Math.floor` guards the `localX ∈ [0, tileSize)`
  // invariant against any caller that happens to pass a fractional value.
  const px = Math.floor(pos.x);
  const py = Math.floor(pos.y);

  // Compute primary tile directly using the supplied tileSize (which may
  // differ from TILE_SIZE in tests or future Stage 18 quadtree code).
  const primary: TileId = {
    x: Math.floor(px / tileSize),
    y: Math.floor(py / tileSize),
  };
  // Local coords inside the primary tile, guaranteed to be in [0, tileSize)
  // by the definition of Math.floor for integer inputs.
  const localX = px - primary.x * tileSize;
  const localY = py - primary.y * tileSize;

  // Narrow `bounds` into a local so TS flow analysis works inside closures
  // under `exactOptionalPropertyTypes`.
  const bb = bounds;
  const accept = (t: TileId): boolean => {
    if (bb === undefined) return true;
    return t.x >= bb.minTile.x && t.x <= bb.maxTile.x && t.y >= bb.minTile.y && t.y <= bb.maxTile.y;
  };

  const result: TileId[] = [];
  if (accept(primary)) result.push(primary);

  const shadowW = shadowWidth > 0 && localX < shadowWidth;
  const shadowE = shadowWidth > 0 && localX >= tileSize - shadowWidth;
  const shadowN = shadowWidth > 0 && localY < shadowWidth;
  const shadowS = shadowWidth > 0 && localY >= tileSize - shadowWidth;

  // Conditional-add-with-bounds helper. The deterministic result ordering
  // is preserved by the call order below — do not reorder without updating
  // the tests that assert on ordering.
  const addIf = (cond: boolean, dx: number, dy: number): void => {
    if (!cond) return;
    const t = { x: primary.x + dx, y: primary.y + dy };
    if (accept(t)) result.push(t);
  };

  // Orthogonals: W, E, N, S.
  addIf(shadowW, -1, 0);
  addIf(shadowE, 1, 0);
  addIf(shadowN, 0, -1);
  addIf(shadowS, 0, 1);
  // Diagonals: NW, NE, SW, SE.
  addIf(shadowW && shadowN, -1, -1);
  addIf(shadowE && shadowN, 1, -1);
  addIf(shadowW && shadowS, -1, 1);
  addIf(shadowE && shadowS, 1, 1);

  return result;
}

/** Return the primary tile from a shadow set — it is always the first
 *  entry by construction, or `undefined` if the set is empty (which can
 *  only happen when `bounds` clips the primary itself). */
export function primaryTileOf(shadowSet: readonly TileId[]): TileId | undefined {
  return shadowSet[0];
}
