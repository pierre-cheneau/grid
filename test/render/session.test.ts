import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { createSessionTracker } from '../../src/render/session.js';

describe('SessionTracker', () => {
  it('counts zero deaths for an always-alive session', () => {
    const t = createSessionTracker(0);
    for (let i = 1; i <= 10; i++) t.update(true, 0, i * 100);
    const s = t.finalize(1100);
    assert.equal(s.deaths, 0);
    assert.equal(s.longestRunMs, 1100);
  });

  it('counts deaths on alive→dead transitions', () => {
    const t = createSessionTracker(0);
    t.update(true, 0, 100);
    t.update(false, 0, 200); // death 1
    t.update(false, 0, 300);
    t.update(true, 0, 400); // respawn
    t.update(false, 0, 500); // death 2
    t.update(true, 0, 600); // respawn
    t.update(false, 0, 700); // death 3
    const s = t.finalize(800);
    assert.equal(s.deaths, 3);
  });

  it('tracks the longest alive run', () => {
    const t = createSessionTracker(0);
    // Run 1: 0→200 (200ms)
    t.update(true, 0, 100);
    t.update(false, 0, 200);
    // Run 2: 300→800 (500ms)
    t.update(true, 0, 300);
    t.update(true, 0, 500);
    t.update(false, 0, 800);
    // Run 3: 900→1000 (100ms), still alive at finalize
    t.update(true, 0, 900);
    const s = t.finalize(1000);
    assert.equal(s.longestRunMs, 500);
  });

  it('passes through the final score as derezzes', () => {
    const t = createSessionTracker(0);
    t.update(true, 3, 100);
    t.update(true, 5, 200);
    const s = t.finalize(300);
    assert.equal(s.derezzes, 5);
  });

  it('computes session duration', () => {
    const t = createSessionTracker(1000);
    t.update(true, 0, 1500);
    const s = t.finalize(2000);
    assert.equal(s.durationMs, 1000);
  });

  it('counts cellsPainted on alive ticks only', () => {
    const t = createSessionTracker(0);
    t.update(true, 0, 100); // alive → +1
    t.update(true, 0, 200); // alive → +1
    t.update(false, 0, 300); // dead → +0
    t.update(false, 0, 400); // dead → +0
    t.update(true, 0, 500); // alive → +1
    const s = t.finalize(600);
    assert.equal(s.cellsPainted, 3);
  });

  it('snapshot returns stats without closing the alive streak', () => {
    const t = createSessionTracker(0);
    t.update(true, 0, 100);
    t.update(true, 0, 200);
    // Snapshot mid-run — longestRunMs should include the open streak
    const s1 = t.snapshot(300);
    assert.equal(s1.longestRunMs, 300); // 0→300 open streak
    assert.equal(s1.cellsPainted, 2);
    // Continue — the streak extends
    t.update(true, 0, 400);
    const s2 = t.snapshot(500);
    assert.equal(s2.longestRunMs, 500); // 0→500 open streak
    assert.equal(s2.cellsPainted, 3);
    // Finalize closes the streak
    const s3 = t.finalize(600);
    assert.equal(s3.longestRunMs, 600);
  });
});
