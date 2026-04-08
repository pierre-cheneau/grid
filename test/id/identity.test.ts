// Tests for the identity layer.

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { fnv1a32 } from '../../src/id/hash.js';
import { deriveLocalId } from '../../src/id/identity.js';

describe('fnv1a32', () => {
  it('matches FNV-1a reference vectors', () => {
    // Standard FNV-1a vectors.
    assert.equal(fnv1a32(''), 0x811c9dc5);
    assert.equal(fnv1a32('a'), 0xe40c292c);
    assert.equal(fnv1a32('foobar'), 0xbf9cf968);
  });

  it('returns a u32 (no negative values)', () => {
    for (const s of ['x', 'corne@thinkpad', 'dev@m1pro', 'a'.repeat(200)]) {
      const h = fnv1a32(s);
      assert.ok(h >= 0 && h <= 0xffff_ffff, `${s} → ${h}`);
    }
  });
});

describe('deriveLocalId', () => {
  it('returns a sanitized id matching the spec format', () => {
    const id = deriveLocalId(() => 1_700_000_000_000);
    assert.match(id.id, /^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+$/);
    assert.ok(id.id.length > 0 && id.id.length <= 64);
  });

  it('joinedAt is unix seconds, not millis', () => {
    const id = deriveLocalId(() => 1_700_000_123_456);
    assert.equal(id.joinedAt, 1_700_000_123);
  });

  it('colorSeed is the FNV-1a of the id', () => {
    const id = deriveLocalId(() => 0);
    assert.equal(id.colorSeed, fnv1a32(id.id));
  });

  it('two calls in the same process give the same id', () => {
    const a = deriveLocalId(() => 0);
    const b = deriveLocalId(() => 0);
    assert.equal(a.id, b.id);
    assert.equal(a.colorSeed, b.colorSeed);
  });
});
