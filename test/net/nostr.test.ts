// Tests for Nostr event signing and verification.
// These test the crypto logic without connecting to real relays.

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  finalizeEvent,
  generateSecretKey,
  getEventHash,
  getPublicKey,
  verifyEvent,
} from 'nostr-tools/pure';

describe('Nostr event signing', () => {
  it('sign → verify roundtrip succeeds', () => {
    const sk = generateSecretKey();
    const event = finalizeEvent(
      { kind: 1, content: 'hello grid', tags: [], created_at: 1700000000 },
      sk,
    );
    assert.equal(verifyEvent(event), true);
  });

  it('event has all required fields', () => {
    const sk = generateSecretKey();
    const event = finalizeEvent(
      {
        kind: 30079,
        content: 'cells',
        tags: [['d', 'grid:2026-04-09:t:0-0']],
        created_at: 1700000000,
      },
      sk,
    );
    assert.equal(typeof event.id, 'string');
    assert.equal(event.id.length, 64);
    assert.equal(typeof event.pubkey, 'string');
    assert.equal(event.pubkey.length, 64);
    assert.equal(typeof event.sig, 'string');
    assert.equal(event.sig.length, 128);
    assert.equal(event.kind, 30079);
    assert.equal(event.content, 'cells');
    assert.equal(event.created_at, 1700000000);
  });

  it('event pubkey matches the signing key', () => {
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);
    const event = finalizeEvent({ kind: 1, content: 'test', tags: [], created_at: 1700000000 }, sk);
    assert.equal(event.pubkey, pk);
  });

  it('tampered content produces a different event hash', () => {
    const sk = generateSecretKey();
    const event = finalizeEvent(
      { kind: 1, content: 'original', tags: [], created_at: 1700000000 },
      sk,
    );
    // Tamper with content — recomputed id won't match the signed id
    const tampered = { ...event, content: 'modified' };
    const recomputedId = getEventHash(tampered);
    assert.notEqual(recomputedId, event.id);
  });

  it('tampered pubkey produces a different event hash', () => {
    const sk = generateSecretKey();
    const event = finalizeEvent({ kind: 1, content: 'test', tags: [], created_at: 1700000000 }, sk);
    const otherPk = getPublicKey(generateSecretKey());
    const tampered = { ...event, pubkey: otherPk };
    const recomputedId = getEventHash(tampered);
    assert.notEqual(recomputedId, event.id);
  });
});

describe('NostrPool', () => {
  it('constructs with custom relay URLs', async () => {
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);
    const { NostrPool } = await import('../../src/net/nostr.js');
    const pool = new NostrPool({
      relayUrls: ['wss://test.relay'],
      seckey: sk,
      pubkey: pk,
    });
    assert.equal(pool.pubkey, pk);
    pool.close();
  });

  it('verify delegates to nostr-tools verifyEvent', async () => {
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);
    const { NostrPool } = await import('../../src/net/nostr.js');
    const pool = new NostrPool({ relayUrls: ['wss://test.relay'], seckey: sk, pubkey: pk });
    const event = finalizeEvent({ kind: 1, content: 'test', tags: [], created_at: 1700000000 }, sk);
    assert.equal(pool.verify(event), true);
    pool.close();
  });
});
