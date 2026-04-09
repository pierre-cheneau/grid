// Tests for deterministic age-based decay.

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { decayCells } from '../../src/sim/decay.js';
import type { Cell } from '../../src/sim/types.js';

function cell(createdAtTick: number, ownerId = 'p:a'): Cell {
  return { type: 'trail', ownerId, createdAtTick, colorSeed: 0 };
}

describe('decayCells', () => {
  it('preserves a cell at age 2*halfLife - 1', () => {
    const cells = new Map([['00000000', cell(0)]]);
    const out = decayCells(cells, 119, 60); // age 119, ceiling 120 — survives
    assert.equal(out.size, 1);
  });

  it('removes a cell at age 2*halfLife', () => {
    const cells = new Map([['00000000', cell(0)]]);
    const out = decayCells(cells, 120, 60); // age 120, ceiling 120 — gone
    assert.equal(out.size, 0);
  });

  it('removes a cell well past the ceiling', () => {
    const cells = new Map([['00000000', cell(0)]]);
    const out = decayCells(cells, 1000, 60);
    assert.equal(out.size, 0);
  });

  it('does not mutate the input map', () => {
    const cells = new Map([['00000000', cell(0)]]);
    decayCells(cells, 1000, 60);
    assert.equal(cells.size, 1);
  });

  it('handles a mix of ages independently', () => {
    const cells = new Map([
      ['00000000', cell(0)], // age 200, gone
      ['00000001', cell(100)], // age 100, alive (ceiling 120)
      ['00000002', cell(200)], // age 0, alive
    ]);
    const out = decayCells(cells, 200, 60);
    assert.equal(out.size, 2);
    assert.ok(out.has('00000001'));
    assert.ok(out.has('00000002'));
  });

  it('returns an empty map for an empty input', () => {
    assert.equal(decayCells(new Map(), 100, 60).size, 0);
  });
});
