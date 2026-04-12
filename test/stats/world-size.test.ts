import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { computeWorldDiameter } from '../../src/stats/world-size.js';

describe('computeWorldDiameter', () => {
  it('returns 60 minimum for zero peak', () => {
    assert.equal(computeWorldDiameter(0), 60);
  });

  it('returns 60 for small peaks (sqrt < 3)', () => {
    assert.equal(computeWorldDiameter(1), 60);
    assert.equal(computeWorldDiameter(8), 60);
  });

  it('returns 60 for peak=9 (20*3=60)', () => {
    assert.equal(computeWorldDiameter(9), 60);
  });

  it('scales with sqrt for moderate peaks', () => {
    // peak=100 → 20*10 = 200
    assert.equal(computeWorldDiameter(100), 200);
    // peak=625 → 20*25 = 500
    assert.equal(computeWorldDiameter(625), 500);
  });

  it('caps at 20000 for very large peaks', () => {
    assert.equal(computeWorldDiameter(1_000_000), 20000);
    assert.equal(computeWorldDiameter(10_000_000), 20000);
  });

  it('returns floor value (no decimals)', () => {
    // peak=10 → 20*sqrt(10) ≈ 63.24 → 63
    assert.equal(computeWorldDiameter(10), 63);
  });

  it('handles negative peak gracefully (clamps to 60)', () => {
    assert.equal(computeWorldDiameter(-1), 60);
  });

  it('handles fractional peak', () => {
    // peak=10.5 → 20*sqrt(10.5) ≈ 64.8 → 64
    assert.equal(computeWorldDiameter(10.5), 64);
  });
});
