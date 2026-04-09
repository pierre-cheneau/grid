import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { dayStartMs, seedFromDay, tickAtTime, todayTag } from '../../src/net/time.js';

describe('dayStartMs', () => {
  it('returns midnight UTC for a given timestamp', () => {
    // 2026-04-09T15:30:00.000Z
    const ts = Date.UTC(2026, 3, 9, 15, 30, 0);
    const ds = dayStartMs(ts);
    const d = new Date(ds);
    assert.equal(d.getUTCHours(), 0);
    assert.equal(d.getUTCMinutes(), 0);
    assert.equal(d.getUTCSeconds(), 0);
    assert.equal(d.getUTCMilliseconds(), 0);
    assert.equal(d.getUTCDate(), 9);
  });

  it('handles midnight exactly', () => {
    const midnight = Date.UTC(2026, 3, 9, 0, 0, 0);
    assert.equal(dayStartMs(midnight), midnight);
  });
});

describe('tickAtTime', () => {
  it('returns 0 at midnight', () => {
    const midnight = Date.UTC(2026, 3, 9, 0, 0, 0);
    assert.equal(tickAtTime(midnight, midnight), 0);
  });

  it('returns 10 at 1 second past midnight', () => {
    const midnight = Date.UTC(2026, 3, 9, 0, 0, 0);
    assert.equal(tickAtTime(midnight + 1000, midnight), 10);
  });

  it('returns ~863999 at 23:59:59.999', () => {
    const midnight = Date.UTC(2026, 3, 9, 0, 0, 0);
    const endOfDay = midnight + 24 * 60 * 60 * 1000 - 1;
    const tick = tickAtTime(endOfDay, midnight);
    assert.equal(tick, 863999);
  });

  it('clamps negative to 0', () => {
    const midnight = Date.UTC(2026, 3, 9, 0, 0, 0);
    assert.equal(tickAtTime(midnight - 1000, midnight), 0);
  });
});

describe('todayTag', () => {
  it('returns YYYY-MM-DD in UTC', () => {
    const ts = Date.UTC(2026, 3, 9, 15, 30, 0);
    assert.equal(todayTag(ts), '2026-04-09');
  });
});

describe('seedFromDay', () => {
  it('is deterministic', () => {
    assert.equal(seedFromDay('2026-04-09'), seedFromDay('2026-04-09'));
  });

  it('returns different seeds for different days', () => {
    assert.notEqual(seedFromDay('2026-04-09'), seedFromDay('2026-04-10'));
  });

  it('returns a bigint', () => {
    assert.equal(typeof seedFromDay('2026-04-09'), 'bigint');
  });
});
