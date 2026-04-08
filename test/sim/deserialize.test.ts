// Round-trip tests for the canonical byte deserializer.
//
// The headline property: for any state s, parseCanonicalBytes(canonicalBytes(s)) is a
// state s' whose canonicalBytes is byte-identical to the original. The Stage 1 hash
// `36f5919d650009ef` MUST remain stable through this round trip.

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import fc from 'fast-check';
import { runScenario } from '../../scripts/determinism-hash.js';
import { parseCanonicalBytes } from '../../src/sim/deserialize.js';
import { hashState } from '../../src/sim/hash.js';
import { newRng } from '../../src/sim/rng.js';
import { canonicalBytes } from '../../src/sim/serialize.js';
import { simulateTick } from '../../src/sim/tick.js';
import type { Cell, Config, GridState, Player } from '../../src/sim/types.js';

const cfg: Config = { width: 16, height: 16, halfLifeTicks: 30, seed: 0xdeadbeefn };

function makeState(): GridState {
  const players = new Map<string, Player>([
    [
      'p:alice',
      {
        id: 'p:alice',
        pos: { x: 5, y: 7 },
        dir: 1,
        isAlive: true,
        respawnAtTick: null,
        score: 3,
        colorSeed: 0x12345678,
      },
    ],
    [
      'p:bob',
      {
        id: 'p:bob',
        pos: { x: 1, y: 2 },
        dir: 2,
        isAlive: false,
        respawnAtTick: 99,
        score: 0,
        colorSeed: 0xabcdef01,
      },
    ],
  ]);
  const cells = new Map<string, Cell>([
    ['00050003', { type: 'trail', ownerId: 'p:alice', createdAtTick: 1 }],
    ['00070005', { type: 'trail', ownerId: 'p:bob', createdAtTick: 2 }],
  ]);
  return {
    tick: 42,
    config: cfg,
    rng: { state: 0x1234_5678_9abc_def0n },
    players,
    cells,
  };
}

describe('parseCanonicalBytes', () => {
  it('round-trips the canonical fixture state byte-for-byte', () => {
    const s = makeState();
    const bytes = canonicalBytes(s);
    const s2 = parseCanonicalBytes(bytes);
    assert.deepEqual(canonicalBytes(s2), bytes);
    assert.equal(hashState(s2), hashState(s));
  });

  it('preserves an empty state', () => {
    const empty: GridState = {
      tick: 0,
      config: cfg,
      rng: newRng(cfg.seed),
      players: new Map(),
      cells: new Map(),
    };
    const bytes = canonicalBytes(empty);
    assert.deepEqual(canonicalBytes(parseCanonicalBytes(bytes)), bytes);
  });

  it('preserves the Stage 1 determinism scenario hash', () => {
    const final = runScenario();
    const bytes = canonicalBytes(final);
    const round = parseCanonicalBytes(bytes);
    assert.equal(hashState(round), '36f5919d650009ef');
  });

  it('rejects bad magic', () => {
    const bytes = canonicalBytes(makeState());
    bytes[0] = 0;
    assert.throws(() => parseCanonicalBytes(bytes), /bad magic/);
  });

  it('rejects unknown FORMAT_VERSION', () => {
    const bytes = canonicalBytes(makeState());
    bytes[4] = 99;
    assert.throws(() => parseCanonicalBytes(bytes), /FORMAT_VERSION/);
  });

  it('rejects truncated input', () => {
    const bytes = canonicalBytes(makeState());
    assert.throws(() => parseCanonicalBytes(bytes.slice(0, 10)), /truncated/);
  });

  it('property: random states round-trip', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 0xffff_ffff_ffff_ffffn }),
        fc.integer({ min: 0, max: 50 }),
        (seed, ticks) => {
          let s: GridState = {
            tick: 0,
            config: { ...cfg, seed },
            rng: newRng(seed),
            players: new Map([
              [
                'p:a',
                {
                  id: 'p:a',
                  pos: { x: 3, y: 4 },
                  dir: 1,
                  isAlive: true,
                  respawnAtTick: null,
                  score: 0,
                  colorSeed: 0,
                },
              ],
            ]),
            cells: new Map(),
          };
          for (let i = 0; i < ticks; i++) {
            s = simulateTick(s, { turns: new Map(), joins: [] });
          }
          const bytes = canonicalBytes(s);
          const round = parseCanonicalBytes(bytes);
          return hashState(round) === hashState(s);
        },
      ),
      { numRuns: 60 },
    );
  });
});
