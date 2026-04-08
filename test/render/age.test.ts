// Tests for the trail age helpers. Pure integer math; the boundaries are exhaustive.

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { ageBucket, ageFraction } from '../../src/render/age.js';

describe('ageBucket', () => {
  // halfLife = 60, so lifetime = 120, buckets = [0..30) [30..60) [60..90) [90..∞)
  const HL = 60;

  it('returns 0 at age 0', () => {
    assert.equal(ageBucket(0, HL), 0);
  });

  it('stays in bucket 0 until age 30', () => {
    for (let a = 0; a < 30; a++) assert.equal(ageBucket(a, HL), 0, `age=${a}`);
  });

  it('moves to bucket 1 at age 30', () => {
    assert.equal(ageBucket(30, HL), 1);
    assert.equal(ageBucket(59, HL), 1);
  });

  it('moves to bucket 2 at age 60 (= halfLife)', () => {
    assert.equal(ageBucket(60, HL), 2);
    assert.equal(ageBucket(89, HL), 2);
  });

  it('moves to bucket 3 at age 90', () => {
    assert.equal(ageBucket(90, HL), 3);
    assert.equal(ageBucket(119, HL), 3);
  });

  it('clamps to bucket 3 at age 120 and beyond', () => {
    assert.equal(ageBucket(120, HL), 3);
    assert.equal(ageBucket(1000, HL), 3);
  });

  it('handles halfLifeTicks <= 0 by returning 0', () => {
    assert.equal(ageBucket(50, 0), 0);
    assert.equal(ageBucket(50, -10), 0);
  });

  it('handles negative age by returning 0', () => {
    assert.equal(ageBucket(-1, HL), 0);
  });
});

describe('ageFraction', () => {
  const HL = 60;

  it('is 0 at age 0', () => {
    assert.equal(ageFraction(0, HL), 0);
  });

  it('is 0.5 at age = halfLife', () => {
    assert.equal(ageFraction(60, HL), 0.5);
  });

  it('is 1 at age = 2 * halfLife', () => {
    assert.equal(ageFraction(120, HL), 1);
  });

  it('clamps to 1 beyond 2 * halfLife', () => {
    assert.equal(ageFraction(1000, HL), 1);
  });

  it('returns 0 for halfLifeTicks <= 0', () => {
    assert.equal(ageFraction(50, 0), 0);
  });
});
