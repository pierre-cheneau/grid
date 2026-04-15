import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { primaryTileOf, shadowTilesOf } from '../../src/net/shadow.js';
import { tileKeyOf } from '../../src/net/tile-id.js';

const SW = 20; // shadow width for most tests
const TS = 256; // TILE_SIZE

function keys(tiles: ReturnType<typeof shadowTilesOf>): string[] {
  return tiles.map(tileKeyOf).sort();
}

describe('shadowTilesOf — primary only (center of tile)', () => {
  it('returns primary when position is deep inside a tile', () => {
    const r = shadowTilesOf({ x: 128, y: 128 }, SW);
    assert.equal(r.length, 1);
    assert.deepEqual(r[0], { x: 0, y: 0 });
  });

  it('returns primary only when shadowWidth is zero', () => {
    const r = shadowTilesOf({ x: 0, y: 0 }, 0);
    assert.equal(r.length, 1);
    assert.deepEqual(r[0], { x: 0, y: 0 });
  });

  it('primary tile is always the first entry (contract)', () => {
    const r = shadowTilesOf({ x: 250, y: 100 }, SW);
    assert.deepEqual(r[0], { x: 0, y: 0 });
    assert.deepEqual(primaryTileOf(r), { x: 0, y: 0 });
  });
});

describe('shadowTilesOf — single-edge shadows', () => {
  it('shadows WEST when near the left edge', () => {
    // Position x=5 is within 20 cells of the left border (x=0).
    const r = shadowTilesOf({ x: 5, y: 128 }, SW);
    assert.deepEqual(keys(r), ['-1-0', '0-0'].sort());
  });

  it('shadows EAST when near the right edge', () => {
    // Position x=250 is within 20 cells of the right border (x=256).
    const r = shadowTilesOf({ x: 250, y: 128 }, SW);
    assert.deepEqual(keys(r), ['0-0', '1-0'].sort());
  });

  it('shadows NORTH when near the top edge', () => {
    const r = shadowTilesOf({ x: 128, y: 5 }, SW);
    assert.deepEqual(keys(r), ['0--1', '0-0'].sort());
  });

  it('shadows SOUTH when near the bottom edge', () => {
    const r = shadowTilesOf({ x: 128, y: 250 }, SW);
    assert.deepEqual(keys(r), ['0-0', '0-1'].sort());
  });
});

describe('shadowTilesOf — corners (two edges + diagonal)', () => {
  it('NW corner: shadows west, north, and NW diagonal', () => {
    const r = shadowTilesOf({ x: 5, y: 5 }, SW);
    assert.deepEqual(keys(r), ['-1--1', '-1-0', '0--1', '0-0'].sort());
  });

  it('NE corner: shadows east, north, and NE diagonal', () => {
    const r = shadowTilesOf({ x: 250, y: 5 }, SW);
    assert.deepEqual(keys(r), ['0--1', '0-0', '1--1', '1-0'].sort());
  });

  it('SW corner: shadows west, south, and SW diagonal', () => {
    const r = shadowTilesOf({ x: 5, y: 250 }, SW);
    assert.deepEqual(keys(r), ['-1-0', '-1-1', '0-0', '0-1'].sort());
  });

  it('SE corner: shadows east, south, and SE diagonal', () => {
    const r = shadowTilesOf({ x: 250, y: 250 }, SW);
    assert.deepEqual(keys(r), ['0-0', '0-1', '1-0', '1-1'].sort());
  });
});

describe('shadowTilesOf — boundary exactly at shadowWidth', () => {
  it('position at shadowWidth - 1 shadows neighbor', () => {
    const r = shadowTilesOf({ x: SW - 1, y: 128 }, SW);
    assert.ok(
      r.some((t) => t.x === -1 && t.y === 0),
      'expected west shadow',
    );
  });

  it('position at shadowWidth does NOT shadow neighbor', () => {
    const r = shadowTilesOf({ x: SW, y: 128 }, SW);
    assert.ok(!r.some((t) => t.x === -1 && t.y === 0), 'should not shadow west');
    assert.equal(r.length, 1);
  });

  it('position at TILE_SIZE - shadowWidth DOES shadow east', () => {
    const r = shadowTilesOf({ x: TS - SW, y: 128 }, SW);
    assert.ok(
      r.some((t) => t.x === 1 && t.y === 0),
      'expected east shadow',
    );
  });

  it('position at TILE_SIZE - shadowWidth - 1 does NOT shadow east', () => {
    const r = shadowTilesOf({ x: TS - SW - 1, y: 128 }, SW);
    assert.ok(!r.some((t) => t.x === 1 && t.y === 0), 'should not shadow east');
  });
});

describe('shadowTilesOf — negative positions', () => {
  it('handles negative tile coords', () => {
    // Position (-5, -5) is in tile (-1, -1). Near the SE corner of that tile
    // (local coords 251, 251). Shadows to (0, -1), (-1, 0), (0, 0).
    const r = shadowTilesOf({ x: -5, y: -5 }, SW);
    assert.deepEqual(keys(r), ['-1--1', '-1-0', '0--1', '0-0'].sort());
  });

  it('near the left edge of tile (-1, 0)', () => {
    // Position (-256, 128) is in tile (-1, 0), local coords (0, 128).
    // Shadows west into tile (-2, 0).
    const r = shadowTilesOf({ x: -256, y: 128 }, SW);
    assert.deepEqual(keys(r), ['-1-0', '-2-0'].sort());
  });
});

describe('shadowTilesOf — large shadowWidth', () => {
  it('shadowWidth >= tileSize includes all 8 neighbors', () => {
    // With shadowWidth = tileSize, every position shadows all 4 orthogonal
    // and all 4 diagonal neighbors. Total = 9 tiles.
    const r = shadowTilesOf({ x: 128, y: 128 }, TS);
    assert.equal(r.length, 9);
  });

  it('shadowWidth greater than tileSize is safe (still 9)', () => {
    const r = shadowTilesOf({ x: 128, y: 128 }, TS * 2);
    assert.equal(r.length, 9);
  });
});

describe('shadowTilesOf — custom tileSize', () => {
  it('respects a non-default tileSize', () => {
    // With tileSize=100, position (95, 50) is in tile (0, 0) (since 95 < 100)
    // and shadows east (local x = 95 >= 100-20 = 80).
    const r = shadowTilesOf({ x: 95, y: 50 }, 20, 100);
    assert.deepEqual(keys(r), ['0-0', '1-0'].sort());
  });
});

describe('shadowTilesOf — boundary exactly at threshold (primary-only)', () => {
  it('position exactly at shadowWidth on x-axis returns primary only', () => {
    const r = shadowTilesOf({ x: SW, y: 128 }, SW);
    assert.equal(r.length, 1);
    assert.deepEqual(r[0], { x: 0, y: 0 });
  });

  it('position at (TILE_SIZE - shadowWidth - 1, 128) returns primary only', () => {
    const r = shadowTilesOf({ x: TS - SW - 1, y: 128 }, SW);
    assert.equal(r.length, 1);
    assert.deepEqual(r[0], { x: 0, y: 0 });
  });
});

describe('shadowTilesOf — world bounds clipping', () => {
  it('excludes shadow tiles outside the world bounds', () => {
    // Player at top-left corner of world (tile 0,0). Without bounds,
    // shadows include (-1, 0), (0, -1), (-1, -1). With bounds min=(0,0),
    // only the primary remains.
    const bounds = { minTile: { x: 0, y: 0 }, maxTile: { x: 10, y: 10 } };
    const r = shadowTilesOf({ x: 5, y: 5 }, SW, TS, bounds);
    assert.equal(r.length, 1);
    assert.deepEqual(r[0], { x: 0, y: 0 });
  });

  it('clips at the eastern world edge', () => {
    // Player in tile (10, 0) near east border. With maxTile.x = 10, shadow
    // to (11, 0) is excluded.
    const bounds = { minTile: { x: 0, y: 0 }, maxTile: { x: 10, y: 10 } };
    const r = shadowTilesOf({ x: 10 * TS + 250, y: 128 }, SW, TS, bounds);
    assert.equal(r.length, 1);
    assert.deepEqual(r[0], { x: 10, y: 0 });
  });

  it('partially clips (keeps in-bounds shadows only)', () => {
    // Corner near (0, 0) with max at (10, 10). Primary (0, 0) and south/east
    // neighbors (1, 0), (0, 1), (1, 1) are in-bounds; west/north (-1, 0),
    // (0, -1), (-1, -1), (-1, 1), (1, -1) are clipped.
    const bounds = { minTile: { x: 0, y: 0 }, maxTile: { x: 10, y: 10 } };
    // Position at (5, 5) shadows NW corner without bounds; with bounds only
    // primary survives (since all neighbor tiles are west or north of 0).
    const r = shadowTilesOf({ x: 5, y: 5 }, SW, TS, bounds);
    assert.equal(r.length, 1);
  });

  it('supports negative-tile-coordinate world bounds', () => {
    // Exotic but valid: world origin at negative tiles. Player at tile (-3, -3),
    // minTile (-5, -5), maxTile (0, 0). All 4 NW-side shadows should remain.
    const bounds = { minTile: { x: -5, y: -5 }, maxTile: { x: 0, y: 0 } };
    const r = shadowTilesOf({ x: -3 * TS + 5, y: -3 * TS + 5 }, SW, TS, bounds);
    // Primary (-3, -3) + W (-4, -3) + N (-3, -4) + NW (-4, -4).
    assert.equal(r.length, 4);
    const ks = r.map((t) => `${t.x}-${t.y}`).sort();
    assert.deepEqual(ks, ['-3--3', '-3--4', '-4--3', '-4--4'].sort());
  });
});

describe('shadowTilesOf — deterministic ordering', () => {
  it('primary is always the first element', () => {
    const samples = [
      { x: 0, y: 0 },
      { x: 250, y: 100 },
      { x: 5, y: 250 },
      { x: 128, y: 128 },
      { x: -5, y: -5 },
    ];
    for (const pos of samples) {
      const r = shadowTilesOf(pos, SW);
      assert.ok(r.length >= 1);
      assert.deepEqual(r[0], {
        x: Math.floor(pos.x / TS),
        y: Math.floor(pos.y / TS),
      });
    }
  });

  it('same input produces same output (deterministic)', () => {
    const pos = { x: 250, y: 250 };
    const a = shadowTilesOf(pos, SW);
    const b = shadowTilesOf(pos, SW);
    assert.deepEqual(a, b);
  });

  it('no duplicate tiles in result', () => {
    const r = shadowTilesOf({ x: 128, y: 128 }, TS); // shadowWidth=tileSize includes all
    const uniqueKeys = new Set(r.map(tileKeyOf));
    assert.equal(uniqueKeys.size, r.length);
  });
});

describe('primaryTileOf', () => {
  it('returns the first element of the shadow set', () => {
    const r = shadowTilesOf({ x: 128, y: 128 }, SW);
    assert.deepEqual(primaryTileOf(r), { x: 0, y: 0 });
  });

  it('returns undefined for an empty array', () => {
    assert.equal(primaryTileOf([]), undefined);
  });
});

// ---- Load-bearing invariants for Stage 14b multi-mesh runtime ----

describe('shadowTilesOf — position exactly at positive tile boundary', () => {
  it('x = TILE_SIZE puts primary in tile 1 and shadows west into tile 0', () => {
    // pos.x = 256 (== TILE_SIZE). tileOfPos returns (1, 0), localX = 0.
    // With shadowWidth > 0, localX < shadowWidth is true → shadow west.
    const r = shadowTilesOf({ x: TS, y: 128 }, SW);
    assert.deepEqual(r[0], { x: 1, y: 0 }, 'primary is tile (1, 0)');
    assert.ok(
      r.some((t) => t.x === 0 && t.y === 0),
      'expected shadow west into tile (0, 0)',
    );
  });

  it('x = 2*TILE_SIZE puts primary in tile 2 and shadows west into tile 1', () => {
    const r = shadowTilesOf({ x: 2 * TS, y: 128 }, SW);
    assert.deepEqual(r[0], { x: 2, y: 0 });
    assert.ok(r.some((t) => t.x === 1 && t.y === 0));
  });
});

describe('shadowTilesOf — cross-tile transition invariant', () => {
  it('(TILE_SIZE - 1, y) and (TILE_SIZE, y) produce OVERLAPPING shadow sets', () => {
    // The critical invariant for seamless cross-tile transitions in Stage 14b:
    // a peer stepping across a boundary must remain visible to the same set
    // of tiles on both sides of the step. Concretely, both positions must
    // have (0, 0) and (1, 0) in their shadow sets — so peers in either tile
    // see the moving peer continuously.
    const before = shadowTilesOf({ x: TS - 1, y: 128 }, SW);
    const after = shadowTilesOf({ x: TS, y: 128 }, SW);
    const keysBefore = new Set(before.map(tileKeyOf));
    const keysAfter = new Set(after.map(tileKeyOf));
    assert.ok(keysBefore.has('0-0') && keysBefore.has('1-0'), 'before includes both tiles');
    assert.ok(keysAfter.has('0-0') && keysAfter.has('1-0'), 'after includes both tiles');
    // Primary swaps:
    assert.deepEqual(before[0], { x: 0, y: 0 });
    assert.deepEqual(after[0], { x: 1, y: 0 });
  });

  it('corner transition at (TILE_SIZE-1, TILE_SIZE-1) → (TILE_SIZE, TILE_SIZE)', () => {
    // Across the SE corner of tile (0, 0) into tile (1, 1): the 4-tile NW
    // corner set must be present on both sides, just with different primary.
    const before = shadowTilesOf({ x: TS - 1, y: TS - 1 }, SW);
    const after = shadowTilesOf({ x: TS, y: TS }, SW);
    const keysBefore = new Set(before.map(tileKeyOf));
    const keysAfter = new Set(after.map(tileKeyOf));
    for (const k of ['0-0', '0-1', '1-0', '1-1']) {
      assert.ok(keysBefore.has(k), `before missing ${k}`);
      assert.ok(keysAfter.has(k), `after missing ${k}`);
    }
    assert.deepEqual(before[0], { x: 0, y: 0 });
    assert.deepEqual(after[0], { x: 1, y: 1 });
  });
});

describe('shadowTilesOf — minimum shadow width', () => {
  it('shadowWidth=1, localX=0 shadows west', () => {
    const r = shadowTilesOf({ x: 0, y: 128 }, 1);
    assert.ok(
      r.some((t) => t.x === -1 && t.y === 0),
      'expected west shadow',
    );
  });

  it('shadowWidth=1, localX=TILE_SIZE-1 shadows east', () => {
    const r = shadowTilesOf({ x: TS - 1, y: 128 }, 1);
    assert.ok(
      r.some((t) => t.x === 1 && t.y === 0),
      'expected east shadow',
    );
  });

  it('shadowWidth=1, localX=1 produces primary only (exclusive boundary)', () => {
    const r = shadowTilesOf({ x: 1, y: 128 }, 1);
    assert.equal(r.length, 1);
  });
});

describe('shadowTilesOf — primary outside world bounds', () => {
  it('returns empty array when primary tile is clipped by bounds', () => {
    // Position is in tile (0, 0) but bounds require minTile (10, 10).
    const bounds = { minTile: { x: 10, y: 10 }, maxTile: { x: 20, y: 20 } };
    const r = shadowTilesOf({ x: 0, y: 0 }, SW, TS, bounds);
    assert.equal(r.length, 0, 'no tiles should be returned');
  });

  it('returns empty array for both primary and shadows out of bounds', () => {
    // Player near a corner of tile (0, 0) — without bounds shadows to (-1, -1).
    // Bounds exclude everything: min=(100,100), max=(200,200).
    const bounds = { minTile: { x: 100, y: 100 }, maxTile: { x: 200, y: 200 } };
    const r = shadowTilesOf({ x: 5, y: 5 }, SW, TS, bounds);
    assert.equal(r.length, 0);
  });

  it('primaryTileOf handles empty result gracefully', () => {
    const bounds = { minTile: { x: 10, y: 10 }, maxTile: { x: 20, y: 20 } };
    const r = shadowTilesOf({ x: 0, y: 0 }, SW, TS, bounds);
    assert.equal(primaryTileOf(r), undefined);
  });
});

describe('shadowTilesOf — tileSize extremes', () => {
  it('tileSize=1 with shadowWidth=0 returns only primary per cell', () => {
    // With tileSize=1 and shadowWidth=0, every cell is its own tile and
    // no shadowing happens. Result is always exactly one tile.
    const r1 = shadowTilesOf({ x: 0, y: 0 }, 0, 1);
    const r2 = shadowTilesOf({ x: 5, y: 7 }, 0, 1);
    assert.equal(r1.length, 1);
    assert.equal(r2.length, 1);
    assert.deepEqual(r1[0], { x: 0, y: 0 });
    assert.deepEqual(r2[0], { x: 5, y: 7 });
  });

  it('tileSize=1 with shadowWidth=1 always shadows all 8 neighbors', () => {
    // At tileSize=1, any position has localX=localY=0, so all 4 orthogonal
    // shadows + 4 diagonals activate → 9 tiles total.
    const r = shadowTilesOf({ x: 0, y: 0 }, 1, 1);
    assert.equal(r.length, 9);
  });
});

describe('shadowTilesOf — input safety (documented as preconditions)', () => {
  it('negative shadowWidth is safely ignored (returns primary only)', () => {
    const r = shadowTilesOf({ x: 5, y: 5 }, -20);
    assert.equal(r.length, 1);
    assert.deepEqual(r[0], { x: 0, y: 0 });
  });

  it('fractional position produces same result as floored integer', () => {
    // tileOfPos uses tileCoords which uses Math.floor.
    const r1 = shadowTilesOf({ x: 128.7, y: 100.3 }, SW);
    const r2 = shadowTilesOf({ x: 128, y: 100 }, SW);
    assert.deepEqual(r1, r2);
  });
});

describe('shadowTilesOf — result array is a fresh object', () => {
  it('mutating returned array does not affect subsequent calls', () => {
    // Defensive API contract: callers can freely mutate the result.
    const r1 = shadowTilesOf({ x: 128, y: 128 }, SW);
    r1.pop();
    const r2 = shadowTilesOf({ x: 128, y: 128 }, SW);
    assert.equal(r2.length, 1, 'subsequent call is independent');
  });
});
