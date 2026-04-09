// The CI determinism scenario, mirrored locally as a unit test with a pinned hash.
// If this test fails alongside a green `npm run determinism:hash`, the script and the
// test have drifted — re-sync them. If both fail, you have a real determinism bug.

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { runScenario } from '../../scripts/determinism-hash.js';
import { hashState } from '../../src/sim/hash.js';

describe('determinism scenario', () => {
  it('produces the pinned hash', () => {
    assert.equal(hashState(runScenario()), 'c599d1866c56a9c9');
  });

  it('is stable across two consecutive runs (local determinism)', () => {
    assert.equal(hashState(runScenario()), hashState(runScenario()));
  });
});
