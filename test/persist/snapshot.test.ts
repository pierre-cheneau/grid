import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  compressSnapshot,
  decodeSnapshot,
  decompressSnapshot,
  encodeSnapshot,
  filterExpiredCells,
} from '../../src/persist/snapshot.js';
import type { Cell, Config } from '../../src/sim/types.js';

const cfg: Config = {
  width: 32,
  height: 16,
  halfLifeTicks: 60,
  seed: 0xc0ffee_deadbeefn,
  circular: false,
};

function makeCells(): Map<string, Cell> {
  return new Map([
    ['00050003', { type: 'trail', ownerId: 'p:alice', createdAtTick: 100, colorSeed: 0xa11ce }],
    ['00070005', { type: 'trail', ownerId: 'p:bob', createdAtTick: 150, colorSeed: 0xb0b }],
  ]);
}

describe('snapshot codec', () => {
  it('round-trips cells, config, and tick', () => {
    const data = { tick: 42, config: cfg, cells: makeCells() };
    const raw = encodeSnapshot(data);
    const decoded = decodeSnapshot(raw);
    assert.equal(decoded.tick, 42);
    assert.equal(decoded.config.width, 32);
    assert.equal(decoded.config.height, 16);
    assert.equal(decoded.config.halfLifeTicks, 60);
    assert.equal(decoded.config.seed, 0xc0ffee_deadbeefn);
    assert.equal(decoded.cells.size, 2);
    const alice = decoded.cells.get('00050003');
    assert.ok(alice);
    assert.equal(alice.ownerId, 'p:alice');
    assert.equal(alice.createdAtTick, 100);
    assert.equal(alice.colorSeed, 0xa11ce);
  });

  it('round-trips an empty cell map', () => {
    const data = { tick: 0, config: cfg, cells: new Map() };
    const decoded = decodeSnapshot(encodeSnapshot(data));
    assert.equal(decoded.cells.size, 0);
  });

  it('rejects bad magic', () => {
    const raw = encodeSnapshot({ tick: 0, config: cfg, cells: new Map() });
    raw[0] = 0xff;
    assert.throws(() => decodeSnapshot(raw), /bad magic/);
  });

  it('rejects truncated input', () => {
    const raw = encodeSnapshot({ tick: 0, config: cfg, cells: makeCells() });
    assert.throws(() => decodeSnapshot(raw.slice(0, 20)));
  });
});

describe('snapshot compression', () => {
  it('compresses and decompresses to the original bytes', () => {
    const raw = encodeSnapshot({ tick: 42, config: cfg, cells: makeCells() });
    const compressed = compressSnapshot(raw);
    const restored = decompressSnapshot(compressed);
    assert.deepEqual(restored, raw);
  });

  it('compressed is smaller than raw for non-trivial data', () => {
    // Build a larger cell set to ensure compression actually helps.
    const cells = new Map<string, Cell>();
    for (let i = 0; i < 100; i++) {
      const key = `0000${i.toString(16).toUpperCase().padStart(4, '0')}`;
      cells.set(key, { type: 'trail', ownerId: 'p:alice', createdAtTick: i, colorSeed: 0xa11ce });
    }
    const raw = encodeSnapshot({ tick: 500, config: cfg, cells });
    const compressed = compressSnapshot(raw);
    assert.ok(
      compressed.length < raw.length,
      `compressed ${compressed.length} >= raw ${raw.length}`,
    );
  });
});

describe('filterExpiredCells', () => {
  it('keeps cells younger than 2 * halfLife', () => {
    const cells = makeCells();
    const alive = filterExpiredCells(cells, 200, 60);
    assert.equal(alive.size, 2);
  });

  it('removes cells at or past the decay ceiling', () => {
    const cells = makeCells();
    // alice cell created at 100, ceiling = 120 ticks. At tick 220, age = 120 → expired.
    const alive = filterExpiredCells(cells, 220, 60);
    assert.equal(alive.size, 1);
    assert.ok(alive.has('00070005')); // bob at tick 150, age 70 < 120
  });

  it('returns empty map when all cells expired', () => {
    const cells = makeCells();
    const alive = filterExpiredCells(cells, 500, 60);
    assert.equal(alive.size, 0);
  });
});
