import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { GENESIS_HASH, computeChainHash } from '../../src/persist/chain.js';

describe('GENESIS_HASH', () => {
  it('is 32 zero bytes', () => {
    assert.equal(GENESIS_HASH.length, 32);
    assert.ok(GENESIS_HASH.every((b) => b === 0));
  });
});

describe('computeChainHash', () => {
  it('returns a 32-byte Uint8Array', () => {
    const h = computeChainHash(GENESIS_HASH, 'a3f8c92b7e1d4f06', 300);
    assert.equal(h.length, 32);
    assert.ok(h instanceof Uint8Array);
  });

  it('is deterministic', () => {
    const a = computeChainHash(GENESIS_HASH, 'a3f8c92b7e1d4f06', 300);
    const b = computeChainHash(GENESIS_HASH, 'a3f8c92b7e1d4f06', 300);
    assert.deepEqual(a, b);
  });

  it('changes with different state hash', () => {
    const a = computeChainHash(GENESIS_HASH, 'a3f8c92b7e1d4f06', 300);
    const b = computeChainHash(GENESIS_HASH, 'ffffffffffffffff', 300);
    assert.notDeepEqual(a, b);
  });

  it('changes with different tick', () => {
    const a = computeChainHash(GENESIS_HASH, 'a3f8c92b7e1d4f06', 300);
    const b = computeChainHash(GENESIS_HASH, 'a3f8c92b7e1d4f06', 600);
    assert.notDeepEqual(a, b);
  });

  it('changes with different prev hash', () => {
    const a = computeChainHash(GENESIS_HASH, 'a3f8c92b7e1d4f06', 300);
    const prev = computeChainHash(GENESIS_HASH, 'abcdef0123456789', 100);
    const b = computeChainHash(prev, 'a3f8c92b7e1d4f06', 300);
    assert.notDeepEqual(a, b);
  });
});
