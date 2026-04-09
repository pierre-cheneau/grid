import { strict as assert } from 'node:assert';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { loadLocalSnapshot, saveLocalSnapshot } from '../../src/persist/local.js';

describe('local snapshot persistence', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'grid-test-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns null for nonexistent file', async () => {
    const result = await loadLocalSnapshot('2026-04-09', dir);
    assert.equal(result, null);
  });

  it('round-trips written data', async () => {
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    await saveLocalSnapshot('2026-04-09', data, dir);
    const loaded = await loadLocalSnapshot('2026-04-09', dir);
    assert.ok(loaded);
    assert.deepEqual(loaded, data);
  });

  it('overwrites existing file', async () => {
    await saveLocalSnapshot('2026-04-09', new Uint8Array([1, 2, 3]), dir);
    await saveLocalSnapshot('2026-04-09', new Uint8Array([4, 5, 6, 7]), dir);
    const loaded = await loadLocalSnapshot('2026-04-09', dir);
    assert.ok(loaded);
    assert.deepEqual(loaded, new Uint8Array([4, 5, 6, 7]));
  });
});
