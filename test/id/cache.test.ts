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
});
