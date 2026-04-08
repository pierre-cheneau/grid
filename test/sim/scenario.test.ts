// The CI determinism scenario, mirrored locally as a unit test with a pinned hash.
// If this test fails alongside a green `npm run determinism:hash`, the script and the
// test have drifted — re-sync them. If both fail, you have a real determinism bug.

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { hashState } from '../../src/sim/hash.js';
import { runScenario } from '../../scripts/determinism-hash.js';

describe('determinism scenario', () => {
  it('produces the pinned hash', () => {
    assert.equal(hashState(runScenario()), '36f5919d650009ef');
  });

  it('is stable across two consecutive runs (local determinism)', () => {
    assert.equal(hashState(runScenario()), hashState(runScenario()));
  });
});
