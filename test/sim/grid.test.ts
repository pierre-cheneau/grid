// Tests for the grid coordinate helpers and direction arithmetic.

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { DIR_DELTA, applyTurn, cellKey, inBounds, parseCellKey } from '../../src/sim/grid.js';
import type { Config, Direction } from '../../src/sim/types.js';

const cfg: Config = { width: 32, height: 16, halfLifeTicks: 60, seed: 0n };

describe('grid', () => {
  describe('cellKey', () => {
    it('is fixed-width 8 hex chars', () => {
      assert.equal(cellKey(0, 0), '00000000');
      assert.equal(cellKey(1, 0), '00000001');
      assert.equal(cellKey(0, 1), '00010000');
      assert.equal(cellKey(15, 16), '0010000F');
    });

    it('lexicographic order = row-major (y, x) order', () => {
      const keys = [cellKey(5, 1), cellKey(0, 0), cellKey(2, 1), cellKey(10, 0), cellKey(0, 2)];
      const sorted = [...keys].sort();
      assert.deepEqual(sorted, [
        cellKey(0, 0),
        cellKey(10, 0),
        cellKey(2, 1),
        cellKey(5, 1),
        cellKey(0, 2),
      ]);
    });

    it('round-trips through parseCellKey', () => {
      for (const [x, y] of [
        [0, 0],
        [1, 2],
        [255, 128],
        [4096, 8192],
      ]) {
        const k = cellKey(x as number, y as number);
        assert.deepEqual(parseCellKey(k), { x, y });
      }
    });
  });

  describe('parseCellKey', () => {
    it('throws on wrong length', () => {
      assert.throws(() => parseCellKey('ABC'));
      assert.throws(() => parseCellKey('123456789'));
    });
  });

  describe('inBounds', () => {
    it('accepts interior cells', () => {
      assert.equal(inBounds(cfg, 0, 0), true);
      assert.equal(inBounds(cfg, 31, 15), true);
      assert.equal(inBounds(cfg, 16, 8), true);
    });

    it('rejects negative coordinates', () => {
      assert.equal(inBounds(cfg, -1, 0), false);
      assert.equal(inBounds(cfg, 0, -1), false);
    });

    it('rejects coordinates at or beyond the dimensions', () => {
      assert.equal(inBounds(cfg, 32, 0), false);
      assert.equal(inBounds(cfg, 0, 16), false);
      assert.equal(inBounds(cfg, 100, 100), false);
    });
  });

  describe('DIR_DELTA', () => {
    it('matches the top-left origin convention', () => {
      // 0=N (-y), 1=E (+x), 2=S (+y), 3=W (-x)
      assert.deepEqual(DIR_DELTA[0], [0, -1]);
      assert.deepEqual(DIR_DELTA[1], [1, 0]);
      assert.deepEqual(DIR_DELTA[2], [0, 1]);
      assert.deepEqual(DIR_DELTA[3], [-1, 0]);
    });
  });

  describe('applyTurn', () => {
    it('preserves direction on no-op input', () => {
      for (const d of [0, 1, 2, 3] as Direction[]) {
        assert.equal(applyTurn(d, ''), d);
        assert.equal(applyTurn(d, 'X'), d);
      }
    });

    it("'L' rotates counter-clockwise: N -> W -> S -> E -> N", () => {
      assert.equal(applyTurn(0, 'L'), 3);
      assert.equal(applyTurn(3, 'L'), 2);
      assert.equal(applyTurn(2, 'L'), 1);
      assert.equal(applyTurn(1, 'L'), 0);
    });

    it("'R' rotates clockwise: N -> E -> S -> W -> N", () => {
      assert.equal(applyTurn(0, 'R'), 1);
      assert.equal(applyTurn(1, 'R'), 2);
      assert.equal(applyTurn(2, 'R'), 3);
      assert.equal(applyTurn(3, 'R'), 0);
    });

    it('two opposite turns return to the original', () => {
      for (const d of [0, 1, 2, 3] as Direction[]) {
        assert.equal(applyTurn(applyTurn(d, 'L'), 'R'), d);
        assert.equal(applyTurn(applyTurn(d, 'R'), 'L'), d);
      }
    });

    it('four turns of the same kind return to the original (full circle)', () => {
      for (const d of [0, 1, 2, 3] as Direction[]) {
        let v = d;
        for (let i = 0; i < 4; i++) v = applyTurn(v, 'L');
        assert.equal(v, d);
        v = d;
        for (let i = 0; i < 4; i++) v = applyTurn(v, 'R');
        assert.equal(v, d);
      }
    });
  });
});
