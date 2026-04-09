// Tests for respawn cell selection.

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { pickSpawnCell } from '../../src/sim/respawn.js';
import { newRng } from '../../src/sim/rng.js';
import type { Cell, Config } from '../../src/sim/types.js';

const cfg: Config = { width: 8, height: 8, halfLifeTicks: 60, seed: 0n, circular: false };

describe('pickSpawnCell', () => {
  it('is deterministic for a fixed seed', () => {
    const a = pickSpawnCell(cfg, new Map(), new Map(), newRng(42n));
    const b = pickSpawnCell(cfg, new Map(), new Map(), newRng(42n));
    assert.deepEqual(a, b);
  });

  it('returns a position inside the grid', () => {
    for (let s = 0; s < 20; s++) {
      const pos = pickSpawnCell(cfg, new Map(), new Map(), newRng(BigInt(s)));
      assert.ok(pos.x >= 0 && pos.x < cfg.width);
      assert.ok(pos.y >= 0 && pos.y < cfg.height);
    }
  });

  it('avoids occupied trail cells', () => {
    // Block every cell except (7,7).
    const cells = new Map<string, Cell>();
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        if (x === 7 && y === 7) continue;
        cells.set(
          `${y.toString(16).toUpperCase().padStart(4, '0')}${x.toString(16).toUpperCase().padStart(4, '0')}`,
          { type: 'trail', ownerId: 'p:x', createdAtTick: 0, colorSeed: 0 },
        );
      }
    }
    const pos = pickSpawnCell(cfg, cells, new Map(), newRng(123n));
    assert.deepEqual(pos, { x: 7, y: 7 });
  });
});
