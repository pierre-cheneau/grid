import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { TILE_SIZE, type TileId, tileEq, tileKeyOf, tileOfPos } from '../../src/net/tile-id.js';

describe('tileOfPos', () => {
  it('maps origin to tile (0, 0)', () => {
    assert.deepEqual(tileOfPos({ x: 0, y: 0 }), { x: 0, y: 0 });
  });

  it('maps within-tile positions to the same tile', () => {
    assert.deepEqual(tileOfPos({ x: 1, y: 1 }), { x: 0, y: 0 });
    assert.deepEqual(tileOfPos({ x: TILE_SIZE - 1, y: TILE_SIZE - 1 }), { x: 0, y: 0 });
  });

  it('crosses tile boundary at TILE_SIZE', () => {
    assert.deepEqual(tileOfPos({ x: TILE_SIZE, y: 0 }), { x: 1, y: 0 });
    assert.deepEqual(tileOfPos({ x: 0, y: TILE_SIZE }), { x: 0, y: 1 });
    assert.deepEqual(tileOfPos({ x: TILE_SIZE, y: TILE_SIZE }), { x: 1, y: 1 });
  });

  it('handles negative positions (negative tile coords)', () => {
    assert.deepEqual(tileOfPos({ x: -1, y: -1 }), { x: -1, y: -1 });
    assert.deepEqual(tileOfPos({ x: -TILE_SIZE, y: 0 }), { x: -1, y: 0 });
    assert.deepEqual(tileOfPos({ x: -TILE_SIZE - 1, y: 0 }), { x: -2, y: 0 });
  });

  it('handles large positions within u16 range', () => {
    // Max u16 = 65535. At TILE_SIZE=256, that's tile 255.
    const max = (1 << 16) - 1;
    assert.deepEqual(tileOfPos({ x: max, y: max }), { x: 255, y: 255 });
  });
});

describe('tileKeyOf', () => {
  it('produces a stable hyphen-separated key', () => {
    assert.equal(tileKeyOf({ x: 0, y: 0 }), '0-0');
    assert.equal(tileKeyOf({ x: 5, y: 12 }), '5-12');
  });

  it('handles negative coords', () => {
    assert.equal(tileKeyOf({ x: -1, y: -1 }), '-1--1');
    assert.equal(tileKeyOf({ x: -10, y: 5 }), '-10-5');
  });

  it('produces unique keys for distinct tiles', () => {
    // Specifically: (0, 10) must not collide with (10, 0).
    assert.notEqual(tileKeyOf({ x: 0, y: 10 }), tileKeyOf({ x: 10, y: 0 }));
  });
});

describe('tileEq', () => {
  it('returns true for identical tiles', () => {
    assert.ok(tileEq({ x: 3, y: 7 }, { x: 3, y: 7 }));
  });

  it('returns false for differing x', () => {
    assert.ok(!tileEq({ x: 3, y: 7 }, { x: 4, y: 7 }));
  });

  it('returns false for differing y', () => {
    assert.ok(!tileEq({ x: 3, y: 7 }, { x: 3, y: 8 }));
  });

  it('handles zero', () => {
    assert.ok(tileEq({ x: 0, y: 0 }, { x: 0, y: 0 }));
  });
});

describe('TileId structural shape', () => {
  it('is a plain object with readonly x, y', () => {
    const t: TileId = { x: 1, y: 2 };
    assert.equal(t.x, 1);
    assert.equal(t.y, 2);
  });
});

describe('TILE_SIZE', () => {
  it('is 256 as documented', () => {
    assert.equal(TILE_SIZE, 256);
  });
});

describe('tileEq (additional edge cases)', () => {
  it('returns false when both x and y differ', () => {
    assert.ok(!tileEq({ x: 1, y: 2 }, { x: 3, y: 4 }));
  });

  it('distinguishes mixed-sign tiles', () => {
    assert.ok(!tileEq({ x: -1, y: 1 }, { x: 1, y: -1 }));
  });

  it('equates two distinct objects with identical coords', () => {
    const a = { x: 5, y: 5 };
    const b = { x: 5, y: 5 };
    assert.ok(tileEq(a, b));
  });
});

describe('tileKeyOf uniqueness under negative coordinates', () => {
  // tileKeyOf produces map keys; the concern is whether two DISTINCT tiles
  // could produce the SAME key string. Since template literals are a
  // deterministic function from (x, y) to string, collisions cannot happen —
  // but these tests document the non-ambiguity across challenging cases.

  it('negative y does not collide with positive y', () => {
    assert.notEqual(tileKeyOf({ x: 1, y: -1 }), tileKeyOf({ x: 1, y: 1 }));
    assert.notEqual(tileKeyOf({ x: -1, y: -1 }), tileKeyOf({ x: -1, y: 1 }));
  });

  it('multi-digit negatives remain distinct', () => {
    assert.notEqual(tileKeyOf({ x: -10, y: -5 }), tileKeyOf({ x: -1, y: -0 }));
    assert.notEqual(tileKeyOf({ x: -10, y: -10 }), tileKeyOf({ x: -1, y: 0 }));
  });

  it('cross-axis hyphens do not confuse coords', () => {
    // Potentially-confusing pairs: "-1--10" vs "-10--1" vs "1--10" vs "10--1"
    const a = tileKeyOf({ x: -1, y: -10 });
    const b = tileKeyOf({ x: -10, y: -1 });
    const c = tileKeyOf({ x: 1, y: -10 });
    const d = tileKeyOf({ x: 10, y: -1 });
    const keys = new Set([a, b, c, d]);
    assert.equal(keys.size, 4);
  });

  it('zero in x or y is unambiguous', () => {
    assert.notEqual(tileKeyOf({ x: 0, y: 10 }), tileKeyOf({ x: 10, y: 0 }));
    assert.notEqual(tileKeyOf({ x: 0, y: -10 }), tileKeyOf({ x: -10, y: 0 }));
    assert.notEqual(tileKeyOf({ x: 0, y: -1 }), tileKeyOf({ x: -1, y: 0 }));
  });
});

describe('round-trip consistency: tileOfPos → tileKeyOf', () => {
  it('is stable for canonical positions', () => {
    const positions = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: TILE_SIZE - 1, y: TILE_SIZE - 1 },
      { x: TILE_SIZE, y: 0 },
      { x: 0, y: TILE_SIZE },
      { x: 2 * TILE_SIZE, y: 3 * TILE_SIZE },
      { x: -1, y: -1 },
      { x: -TILE_SIZE, y: -TILE_SIZE },
    ];
    for (const p of positions) {
      const k1 = tileKeyOf(tileOfPos(p));
      const k2 = tileKeyOf(tileOfPos(p));
      assert.equal(k1, k2, `round-trip unstable for ${JSON.stringify(p)}`);
    }
  });

  it('maps all positions within a tile to the same key', () => {
    // Tile (1, 1) covers positions [256..511, 256..511]. All positions in this
    // range should produce key "1-1".
    const expected = tileKeyOf({ x: 1, y: 1 });
    const sampled = [
      { x: TILE_SIZE, y: TILE_SIZE },
      { x: TILE_SIZE + 1, y: TILE_SIZE },
      { x: 2 * TILE_SIZE - 1, y: 2 * TILE_SIZE - 1 },
      { x: TILE_SIZE + 100, y: TILE_SIZE + 42 },
    ];
    for (const p of sampled) {
      assert.equal(tileKeyOf(tileOfPos(p)), expected);
    }
  });
});

describe('tileOfPos at TILE_SIZE multiples', () => {
  it('handles multiples of TILE_SIZE', () => {
    assert.deepEqual(tileOfPos({ x: 2 * TILE_SIZE, y: 0 }), { x: 2, y: 0 });
    assert.deepEqual(tileOfPos({ x: 3 * TILE_SIZE, y: 4 * TILE_SIZE }), { x: 3, y: 4 });
    assert.deepEqual(tileOfPos({ x: 10 * TILE_SIZE, y: 10 * TILE_SIZE }), { x: 10, y: 10 });
  });
});
