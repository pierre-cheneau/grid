import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { mergeCellMaps, partitionByTile, tileCoords, worldTiles } from '../../src/persist/tile.js';
import { cellKey } from '../../src/sim/grid.js';
import type { Cell } from '../../src/sim/types.js';

function makeCell(tick: number, owner = 'p:test'): Cell {
  return { type: 'trail', ownerId: owner, createdAtTick: tick, colorSeed: 0 };
}

describe('tileCoords', () => {
  it('maps origin to tile (0,0)', () => {
    assert.deepEqual(tileCoords(0, 0), { tileX: 0, tileY: 0 });
  });

  it('maps (255,255) to tile (0,0)', () => {
    assert.deepEqual(tileCoords(255, 255), { tileX: 0, tileY: 0 });
  });

  it('maps (256,0) to tile (1,0)', () => {
    assert.deepEqual(tileCoords(256, 0), { tileX: 1, tileY: 0 });
  });

  it('maps (256,256) to tile (1,1)', () => {
    assert.deepEqual(tileCoords(256, 256), { tileX: 1, tileY: 1 });
  });

  it('maps (512,768) to tile (2,3)', () => {
    assert.deepEqual(tileCoords(512, 768), { tileX: 2, tileY: 3 });
  });

  it('handles large coordinates near u16 max', () => {
    assert.deepEqual(tileCoords(65535, 65535), { tileX: 255, tileY: 255 });
  });
});

describe('worldTiles', () => {
  it('250×250 world has 1 tile', () => {
    const tiles = worldTiles(250, 250);
    assert.equal(tiles.length, 1);
    assert.deepEqual(tiles[0], { tileX: 0, tileY: 0 });
  });

  it('256×256 world has 1 tile', () => {
    assert.equal(worldTiles(256, 256).length, 1);
  });

  it('257×257 world has 4 tiles', () => {
    const tiles = worldTiles(257, 257);
    assert.equal(tiles.length, 4);
  });

  it('512×512 world has 4 tiles', () => {
    const tiles = worldTiles(512, 512);
    assert.equal(tiles.length, 4);
    assert.deepEqual(tiles[0], { tileX: 0, tileY: 0 });
    assert.deepEqual(tiles[3], { tileX: 1, tileY: 1 });
  });

  it('1000×500 world has 4×2=8 tiles', () => {
    assert.equal(worldTiles(1000, 500).length, 8);
  });

  it('0×0 world has 0 tiles', () => {
    assert.equal(worldTiles(0, 0).length, 0);
  });

  it('1×1 world has 1 tile', () => {
    assert.equal(worldTiles(1, 1).length, 1);
  });
});

describe('partitionByTile', () => {
  it('empty map returns empty partition', () => {
    const result = partitionByTile(new Map());
    assert.equal(result.length, 0);
  });

  it('cells in same tile group together', () => {
    const cells = new Map<string, Cell>();
    cells.set(cellKey(10, 20), makeCell(100));
    cells.set(cellKey(100, 200), makeCell(200));
    const result = partitionByTile(cells);
    assert.equal(result.length, 1);
    assert.equal(result[0]?.tileX, 0);
    assert.equal(result[0]?.tileY, 0);
    assert.equal(result[0]?.cells.size, 2);
  });

  it('cells in different tiles partition correctly', () => {
    const cells = new Map<string, Cell>();
    cells.set(cellKey(10, 10), makeCell(100)); // tile (0,0)
    cells.set(cellKey(300, 10), makeCell(200)); // tile (1,0)
    cells.set(cellKey(10, 300), makeCell(300)); // tile (0,1)
    const result = partitionByTile(cells);
    assert.equal(result.length, 3);
    const findTile = (tx: number, ty: number) =>
      result.find((t) => t.tileX === tx && t.tileY === ty);
    assert.equal(findTile(0, 0)?.cells.size, 1);
    assert.equal(findTile(1, 0)?.cells.size, 1);
    assert.equal(findTile(0, 1)?.cells.size, 1);
  });
});

describe('mergeCellMaps', () => {
  it('disjoint maps produce union', () => {
    const a = new Map<string, Cell>([['k1', makeCell(100)]]);
    const b = new Map<string, Cell>([['k2', makeCell(200)]]);
    const merged = mergeCellMaps(a, b);
    assert.equal(merged.size, 2);
    assert.ok(merged.has('k1'));
    assert.ok(merged.has('k2'));
  });

  it('overlapping keys: latest createdAtTick wins', () => {
    const a = new Map<string, Cell>([['k1', makeCell(100, 'old')]]);
    const b = new Map<string, Cell>([['k1', makeCell(200, 'new')]]);
    const merged = mergeCellMaps(a, b);
    assert.equal(merged.size, 1);
    assert.equal(merged.get('k1')?.ownerId, 'new');
  });

  it('overlapping keys with same tick: a has priority', () => {
    const a = new Map<string, Cell>([['k1', makeCell(100, 'first')]]);
    const b = new Map<string, Cell>([['k1', makeCell(100, 'second')]]);
    const merged = mergeCellMaps(a, b);
    assert.equal(merged.get('k1')?.ownerId, 'first');
  });

  it('both empty returns empty', () => {
    assert.equal(mergeCellMaps(new Map(), new Map()).size, 0);
  });

  it('one empty returns other', () => {
    const cells = new Map<string, Cell>([['k1', makeCell(100)]]);
    assert.equal(mergeCellMaps(cells, new Map()).size, 1);
    assert.equal(mergeCellMaps(new Map(), cells).size, 1);
  });

  it('is idempotent: merge(a, a) === a', () => {
    const a = new Map<string, Cell>([
      ['k1', makeCell(100)],
      ['k2', makeCell(200)],
    ]);
    const merged = mergeCellMaps(a, a);
    assert.equal(merged.size, 2);
    assert.equal(merged.get('k1')?.createdAtTick, 100);
    assert.equal(merged.get('k2')?.createdAtTick, 200);
  });

  it('is commutative for disjoint sets', () => {
    const a = new Map<string, Cell>([['k1', makeCell(100, 'alice')]]);
    const b = new Map<string, Cell>([['k2', makeCell(200, 'bob')]]);
    const ab = mergeCellMaps(a, b);
    const ba = mergeCellMaps(b, a);
    assert.equal(ab.size, ba.size);
    assert.equal(ab.get('k1')?.ownerId, ba.get('k1')?.ownerId);
    assert.equal(ab.get('k2')?.ownerId, ba.get('k2')?.ownerId);
  });
});
