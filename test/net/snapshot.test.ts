// Snapshot codec round-trip tests.

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { runScenario } from '../../scripts/determinism-hash.js';
import { decodeSnapshot, encodeSnapshot } from '../../src/net/snapshot.js';
import { hashState } from '../../src/sim/hash.js';

describe('snapshot codec', () => {
  it('round-trips the Stage 1 scenario state', () => {
    const s = runScenario();
    const b64 = encodeSnapshot(s);
    const round = decodeSnapshot(b64);
    assert.equal(hashState(round), hashState(s));
    assert.equal(hashState(round), 'c599d1866c56a9c9');
  });

  it('produces a base64 string', () => {
    const s = runScenario();
    const b64 = encodeSnapshot(s);
    assert.match(b64, /^[A-Za-z0-9+/]+=*$/);
  });
});
