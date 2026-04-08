// Tests for the PCG32 implementation.
//
// THE PINNED REFERENCE VECTORS in this file are the cross-port contract: any future
// language port (Python, Go, Rust) MUST produce the exact same `nextU32` sequence
// for the same seed. If you change the PCG32 implementation, these vectors must
// continue to pass; if they don't, you've changed the algorithm and broken every
// existing replay file.

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { cloneRng, newRng, nextRangeU32, nextU32, splitmix64 } from '../../src/sim/rng.js';

describe('rng', () => {
  describe('splitmix64', () => {
    // Reference vectors computed from the canonical splitmix64 step.
    // These are widely published; matching them confirms our bigint port is correct.
    it('matches published reference vectors', () => {
      assert.equal(splitmix64(0n), 0xe220a8397b1dcdafn);
      assert.equal(splitmix64(1n), 0x910a2dec89025cc1n);
      assert.equal(splitmix64(0xdeadbeefn), 0x4adfb90f68c9eb9bn);
    });

    it('is pure (no internal state)', () => {
      assert.equal(splitmix64(42n), splitmix64(42n));
    });
  });

  describe('newRng', () => {
    it('seeds the rng deterministically', () => {
      const a = newRng(0n);
      const b = newRng(0n);
      assert.equal(a.state, b.state);
    });

    it('different seeds produce different states', () => {
      const a = newRng(0n);
      const b = newRng(1n);
      assert.notEqual(a.state, b.state);
    });
  });

  describe('cloneRng', () => {
    it('returns an independent copy', () => {
      const a = newRng(0n);
      const b = cloneRng(a);
      nextU32(a);
      assert.notEqual(a.state, b.state);
    });
  });

  describe('nextU32', () => {
    it('produces values in the u32 range', () => {
      const rng = newRng(0n);
      for (let i = 0; i < 1000; i++) {
        const v = nextU32(rng);
        assert.ok(Number.isInteger(v));
        assert.ok(v >= 0);
        assert.ok(v <= 0xff_ff_ff_ff);
      }
    });

    it('advances the rng state on every call', () => {
      const rng = newRng(0n);
      const before = rng.state;
      nextU32(rng);
      assert.notEqual(rng.state, before);
    });

    // PINNED REFERENCE VECTOR (the cross-port contract).
    // These exact 8 values must be produced by every future implementation of
    // PCG32 with the same seeding. To re-pin: run `npm test` and copy the actual
    // values from a failing run, then verify them against an independent implementation.
    it('produces the pinned sequence for seed=0n', () => {
      const rng = newRng(0n);
      const seq: number[] = [];
      for (let i = 0; i < 8; i++) seq.push(nextU32(rng));
      assert.deepEqual(
        seq,
        [
          1092706980, 278790474, 1039822109, 1377468856, 2033553421, 812736149, 2537966385,
          2065831338,
        ],
      );
    });

    it('produces the pinned sequence for seed=42n', () => {
      const rng = newRng(42n);
      const seq: number[] = [];
      for (let i = 0; i < 8; i++) seq.push(nextU32(rng));
      assert.deepEqual(
        seq,
        [
          3344234869, 1768956483, 4001043839, 743431577, 2248556757, 1371427516, 2826524762,
          1106090679,
        ],
      );
    });
  });

  describe('nextRangeU32', () => {
    it('returns values in [0, max)', () => {
      const rng = newRng(123n);
      for (let i = 0; i < 1000; i++) {
        const v = nextRangeU32(rng, 100);
        assert.ok(v >= 0);
        assert.ok(v < 100);
        assert.ok(Number.isInteger(v));
      }
    });

    it('returns 0 deterministically when max=1', () => {
      const rng = newRng(0n);
      for (let i = 0; i < 10; i++) {
        assert.equal(nextRangeU32(rng, 1), 0);
      }
    });

    it('throws on invalid max', () => {
      const rng = newRng(0n);
      assert.throws(() => nextRangeU32(rng, 0));
      assert.throws(() => nextRangeU32(rng, -1));
      assert.throws(() => nextRangeU32(rng, 1.5));
      assert.throws(() => nextRangeU32(rng, 0x1_00_00_00_01));
    });

    it('produces a roughly uniform distribution over a small range', () => {
      // Smoke check, not a statistical test. Each bucket should be hit at least once.
      const rng = newRng(7n);
      const buckets = new Array(8).fill(0);
      for (let i = 0; i < 10_000; i++) {
        buckets[nextRangeU32(rng, 8)]++;
      }
      for (const b of buckets) {
        assert.ok(b > 0, `bucket should be non-empty, got ${b}`);
      }
    });
  });
});
