// Identity cache tests. Uses os.tmpdir for isolation.

import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { resolveIdentity } from '../../src/id/cache.js';

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'grid-cache-test-'));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe('resolveIdentity', () => {
  it('derives a fresh identity when no cache exists', async () => {
    const id = await resolveIdentity(() => 1_700_000_000_000, testDir);
    assert.ok(id.id.length > 0);
    assert.ok(typeof id.colorSeed === 'number');
    assert.equal(id.joinedAt, 1_700_000_000);
  });

  it('writes the cache file on first derivation', async () => {
    await resolveIdentity(() => 0, testDir);
    const raw = await readFile(join(testDir, 'identity.json'), 'utf8');
    const data = JSON.parse(raw);
    assert.ok(typeof data.id === 'string');
    assert.ok(typeof data.colorSeed === 'number');
  });

  it('returns the cached identity on subsequent calls', async () => {
    const first = await resolveIdentity(() => 1_000_000_000_000, testDir);
    const second = await resolveIdentity(() => 2_000_000_000_000, testDir);
    assert.equal(first.id, second.id);
    assert.equal(first.colorSeed, second.colorSeed);
    // joinedAt is fresh each session
    assert.notEqual(first.joinedAt, second.joinedAt);
  });

  it('re-derives if the cache file is corrupt JSON', async () => {
    await writeFile(join(testDir, 'identity.json'), 'not json!!!', 'utf8');
    const id = await resolveIdentity(() => 0, testDir);
    assert.ok(id.id.length > 0);
  });

  it('re-derives if the cache file has wrong shape', async () => {
    await writeFile(join(testDir, 'identity.json'), '{"foo": 42}', 'utf8');
    const id = await resolveIdentity(() => 0, testDir);
    assert.ok(id.id.length > 0);
  });

  it('fresh identity includes Nostr keypair', async () => {
    const id = await resolveIdentity(() => 0, testDir);
    assert.ok(id.nostrSeckey instanceof Uint8Array);
    assert.equal(id.nostrSeckey.length, 32);
    assert.equal(typeof id.nostrPubkey, 'string');
    assert.match(id.nostrPubkey, /^[0-9a-f]{64}$/);
  });

  it('cached identity preserves Nostr keypair across sessions', async () => {
    const first = await resolveIdentity(() => 1_000_000_000_000, testDir);
    const second = await resolveIdentity(() => 2_000_000_000_000, testDir);
    assert.deepEqual(first.nostrSeckey, second.nostrSeckey);
    assert.equal(first.nostrPubkey, second.nostrPubkey);
  });

  it('v0.1 cache without keypair triggers migration', async () => {
    // Write a v0.1-style cache (no keypair)
    await writeFile(
      join(testDir, 'identity.json'),
      JSON.stringify({ id: 'test@host', colorSeed: 12345 }),
      'utf8',
    );
    const id = await resolveIdentity(() => 0, testDir);
    assert.equal(id.id, 'test@host');
    assert.equal(id.colorSeed, 12345);
    // Keypair should be generated
    assert.ok(id.nostrSeckey instanceof Uint8Array);
    assert.equal(id.nostrSeckey.length, 32);
    assert.match(id.nostrPubkey, /^[0-9a-f]{64}$/);
    // Cache should now include keypair
    const raw = await readFile(join(testDir, 'identity.json'), 'utf8');
    const data = JSON.parse(raw);
    assert.equal(typeof data.nostrSeckey, 'string');
    assert.equal(data.nostrSeckey.length, 64);
    assert.equal(typeof data.nostrPubkey, 'string');
  });

  it('subsequent reads after migration return the same keypair', async () => {
    await writeFile(
      join(testDir, 'identity.json'),
      JSON.stringify({ id: 'test@host', colorSeed: 42 }),
      'utf8',
    );
    const first = await resolveIdentity(() => 0, testDir);
    const second = await resolveIdentity(() => 0, testDir);
    assert.deepEqual(first.nostrSeckey, second.nostrSeckey);
    assert.equal(first.nostrPubkey, second.nostrPubkey);
  });

  it('cache with invalid hex in nostrSeckey triggers re-derive with new keypair', async () => {
    await writeFile(
      join(testDir, 'identity.json'),
      JSON.stringify({ id: 'test@host', colorSeed: 42, nostrSeckey: 'ZZZZ', nostrPubkey: 'bad' }),
      'utf8',
    );
    // Invalid hex → falls back to legacy path → generates keypair
    const id = await resolveIdentity(() => 0, testDir);
    assert.equal(id.id, 'test@host');
    assert.ok(id.nostrSeckey instanceof Uint8Array);
    assert.equal(id.nostrSeckey.length, 32);
    assert.match(id.nostrPubkey, /^[0-9a-f]{64}$/);
  });

  it('cache with truncated nostrSeckey triggers re-derive', async () => {
    await writeFile(
      join(testDir, 'identity.json'),
      JSON.stringify({
        id: 'test@host',
        colorSeed: 42,
        nostrSeckey: 'abcd1234',
        nostrPubkey: 'a'.repeat(64),
      }),
      'utf8',
    );
    const id = await resolveIdentity(() => 0, testDir);
    assert.equal(id.id, 'test@host');
    assert.equal(id.nostrSeckey.length, 32);
    assert.match(id.nostrPubkey, /^[0-9a-f]{64}$/);
  });

  it('fresh derivation writes keypair to cache file', async () => {
    await resolveIdentity(() => 0, testDir);
    const raw = await readFile(join(testDir, 'identity.json'), 'utf8');
    const data = JSON.parse(raw);
    assert.equal(typeof data.nostrSeckey, 'string');
    assert.equal(data.nostrSeckey.length, 64);
    assert.match(data.nostrSeckey, /^[0-9a-f]{64}$/);
    assert.equal(typeof data.nostrPubkey, 'string');
    assert.equal(data.nostrPubkey.length, 64);
    assert.match(data.nostrPubkey, /^[0-9a-f]{64}$/);
  });

  it('re-derive from corrupt JSON produces valid keypair', async () => {
    await writeFile(join(testDir, 'identity.json'), '{{{garbage', 'utf8');
    const id = await resolveIdentity(() => 0, testDir);
    assert.ok(id.nostrSeckey instanceof Uint8Array);
    assert.equal(id.nostrSeckey.length, 32);
    assert.match(id.nostrPubkey, /^[0-9a-f]{64}$/);
  });

  it('cache with mismatched seckey/pubkey regenerates keypair', async () => {
    // Valid hex format but pubkey doesn't match seckey
    const { generateSecretKey, getPublicKey } = await import('nostr-tools/pure');
    const realSk = generateSecretKey();
    const wrongPk = getPublicKey(generateSecretKey()); // pubkey from a different key
    await writeFile(
      join(testDir, 'identity.json'),
      JSON.stringify({
        id: 'test@host',
        colorSeed: 99,
        nostrSeckey: Buffer.from(realSk).toString('hex'),
        nostrPubkey: wrongPk,
      }),
      'utf8',
    );
    const id = await resolveIdentity(() => 0, testDir);
    assert.equal(id.id, 'test@host');
    // Should have regenerated — pubkey should match seckey
    const { getPublicKey: gp } = await import('nostr-tools/pure');
    assert.equal(id.nostrPubkey, gp(id.nostrSeckey));
    // And should NOT be the wrong pubkey
    assert.notEqual(id.nostrPubkey, wrongPk);
  });
});
