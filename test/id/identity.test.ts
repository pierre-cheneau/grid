// Tests for the identity layer.

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { getPublicKey } from 'nostr-tools/pure';
import { fnv1a32 } from '../../src/id/hash.js';
import { deriveLocalId, generateNostrKeypair, rebaseIdentity } from '../../src/id/identity.js';

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

  it('includes a Nostr keypair', () => {
    const id = deriveLocalId(() => 0);
    assert.ok(id.nostrSeckey instanceof Uint8Array);
    assert.equal(id.nostrSeckey.length, 32);
    assert.equal(typeof id.nostrPubkey, 'string');
    assert.equal(id.nostrPubkey.length, 64);
  });

  it('Nostr pubkey is derived from seckey', () => {
    const id = deriveLocalId(() => 0);
    assert.equal(id.nostrPubkey, getPublicKey(id.nostrSeckey));
  });

  it('each call generates a different keypair (random, not id-derived)', () => {
    const a = deriveLocalId(() => 0);
    const b = deriveLocalId(() => 0);
    assert.notDeepEqual(a.nostrSeckey, b.nostrSeckey);
    assert.notEqual(a.nostrPubkey, b.nostrPubkey);
  });
});

describe('rebaseIdentity', () => {
  it('derives a distinct keypair from the base identity', () => {
    const base = deriveLocalId(() => 0);
    const rebased = rebaseIdentity(base, 'bot1');
    // Two terminals on the same machine with different --name flags must have
    // different network identities, otherwise pubkey-based peer discovery
    // would collapse them into one peer.
    assert.notDeepEqual(rebased.nostrSeckey, base.nostrSeckey);
    assert.notEqual(rebased.nostrPubkey, base.nostrPubkey);
    assert.equal(rebased.nostrSeckey.length, 32);
    assert.match(rebased.nostrPubkey, /^[0-9a-f]{64}$/);
  });

  it('rebased pubkey is derived from rebased seckey', () => {
    const base = deriveLocalId(() => 0);
    const rebased = rebaseIdentity(base, 'bot1');
    assert.equal(rebased.nostrPubkey, getPublicKey(rebased.nostrSeckey));
  });

  it('is deterministic: same suffix on same base yields same rebased identity', () => {
    const base = deriveLocalId(() => 0);
    const r1 = rebaseIdentity(base, 'alt');
    const r2 = rebaseIdentity(base, 'alt');
    assert.deepEqual(r1.nostrSeckey, r2.nostrSeckey);
    assert.equal(r1.nostrPubkey, r2.nostrPubkey);
  });

  it('different suffixes produce different keypairs', () => {
    const base = deriveLocalId(() => 0);
    const a = rebaseIdentity(base, 'a');
    const b = rebaseIdentity(base, 'b');
    assert.notDeepEqual(a.nostrSeckey, b.nostrSeckey);
    assert.notEqual(a.nostrPubkey, b.nostrPubkey);
  });

  it('changes id and colorSeed, preserves joinedAt', () => {
    const base = deriveLocalId(() => 0);
    const rebased = rebaseIdentity(base, 'alt');
    assert.notEqual(rebased.id, base.id);
    assert.notEqual(rebased.colorSeed, base.colorSeed);
    assert.equal(rebased.joinedAt, base.joinedAt);
  });
});

describe('generateNostrKeypair', () => {
  it('returns a 32-byte seckey and 64-char hex pubkey', () => {
    const kp = generateNostrKeypair();
    assert.ok(kp.seckey instanceof Uint8Array);
    assert.equal(kp.seckey.length, 32);
    assert.equal(typeof kp.pubkey, 'string');
    assert.equal(kp.pubkey.length, 64);
    assert.match(kp.pubkey, /^[0-9a-f]{64}$/);
  });

  it('pubkey is deterministically derived from seckey', () => {
    const kp = generateNostrKeypair();
    assert.equal(kp.pubkey, getPublicKey(kp.seckey));
  });

  it('two calls produce different keypairs', () => {
    const a = generateNostrKeypair();
    const b = generateNostrKeypair();
    assert.notDeepEqual(a.seckey, b.seckey);
    assert.notEqual(a.pubkey, b.pubkey);
  });
});
