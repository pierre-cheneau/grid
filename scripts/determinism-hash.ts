// CI determinism fixture: a single fixed scenario whose final hash is compared
// byte-for-byte across Linux and Windows runners.
//
// If you change anything in this file, you must also update the matching pinned vector
// in `test/sim/scenario.test.ts`.

import { hashState, newRng, simulateTick } from '../src/sim/index.js';
import type { Config, GridState, Inputs, Turn } from '../src/sim/index.js';

const cfg: Config = {
  width: 32,
  height: 32,
  halfLifeTicks: 60,
  seed: 0xc0ffee_deadbeefn,
  circular: false,
};

function initialState(): GridState {
  return {
    tick: 0,
    config: cfg,
    rng: newRng(cfg.seed),
    players: new Map([
      [
        'p:alice',
        {
          id: 'p:alice',
          pos: { x: 5, y: 16 },
          dir: 1, // E
          isAlive: true,
          respawnAtTick: null,
          score: 0,
          colorSeed: 0xa11ce,
        },
      ],
      [
        'p:bob',
        {
          id: 'p:bob',
          pos: { x: 26, y: 16 },
          dir: 3, // W
          isAlive: true,
          respawnAtTick: null,
          score: 0,
          colorSeed: 0xb0b,
        },
      ],
    ]),
    cells: new Map(),
  };
}

// Hardcoded turn schedule. `[tick, playerId, turn]`. Anything not listed is a no-op.
const SCHEDULE: ReadonlyArray<readonly [number, string, Turn]> = [
  [10, 'p:alice', 'L'],
  [15, 'p:bob', 'R'],
  [25, 'p:alice', 'R'],
  [40, 'p:bob', 'L'],
  [55, 'p:alice', 'R'],
  [70, 'p:alice', 'L'],
  [85, 'p:bob', 'R'],
  [100, 'p:alice', 'L'],
  [120, 'p:bob', 'L'],
  [140, 'p:alice', 'R'],
  [160, 'p:bob', 'R'],
  [180, 'p:alice', 'L'],
];

function inputsForTick(t: number): Inputs {
  const turns = new Map<string, Turn>();
  for (const [tick, id, turn] of SCHEDULE) {
    if (tick === t) turns.set(id, turn);
  }
  return { turns, joins: [] };
}

export function runScenario(): GridState {
  let s = initialState();
  for (let t = 0; t < 200; t++) {
    s = simulateTick(s, inputsForTick(t));
  }
  return s;
}

function main(): void {
  const finalState = runScenario();
  const h = hashState(finalState);
  process.stdout.write(`GRID_HASH=${h}\n`);
}

main();
