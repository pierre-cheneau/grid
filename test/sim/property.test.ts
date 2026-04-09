import { describe, it } from 'node:test';
import fc from 'fast-check';
import { hashState } from '../../src/sim/hash.js';
import { newRng } from '../../src/sim/rng.js';
import { simulateTick } from '../../src/sim/tick.js';
import type { Direction, GridState, Inputs, Player, Turn } from '../../src/sim/types.js';

fc.configureGlobal({ numRuns: 80 });

const cfg = { width: 16, height: 16, halfLifeTicks: 30, seed: 0n, circular: false };

const dirArb = fc.constantFrom<Direction>(0, 1, 2, 3);
const turnArb = fc.constantFrom<Turn>('', 'L', 'R');

function makePlayer(id: string, x: number, y: number, dir: Direction): Player {
  return { id, pos: { x, y }, dir, isAlive: true, respawnAtTick: null, score: 0, colorSeed: 0 };
}

const stateArb = fc
  .tuple(
    fc.integer({ min: 1, max: 14 }),
    fc.integer({ min: 1, max: 14 }),
    dirArb,
    fc.integer({ min: 1, max: 14 }),
    fc.integer({ min: 1, max: 14 }),
    dirArb,
    fc.bigInt({ min: 0n, max: 0xffff_ffff_ffff_ffffn }),
  )
  .map(([ax, ay, ad, bx, by, bd, seed]): GridState => {
    // Avoid putting both players on the same cell.
    const bxAdj = bx === ax && by === ay ? (bx + 1) % 14 : bx;
    return {
      tick: 0,
      config: { ...cfg, seed },
      rng: newRng(seed),
      players: new Map([
        ['p:a', makePlayer('p:a', ax, ay, ad)],
        ['p:b', makePlayer('p:b', bxAdj, by, bd)],
      ]),
      cells: new Map(),
    };
  });

const inputsArb = fc.array(fc.record({ a: turnArb, b: turnArb }), { minLength: 1, maxLength: 30 });

function lastState(states: GridState[]): GridState {
  const s = states[states.length - 1];
  if (s === undefined) throw new Error('runSequence returned no states');
  return s;
}

function runSequence(initial: GridState, seq: ReadonlyArray<{ a: Turn; b: Turn }>): GridState[] {
  const out: GridState[] = [initial];
  let s = initial;
  for (const step of seq) {
    const inputs: Inputs = {
      turns: new Map<string, Turn>([
        ['p:a', step.a],
        ['p:b', step.b],
      ]),
      joins: [],
    };
    s = simulateTick(s, inputs);
    out.push(s);
  }
  return out;
}

function reorderMaps(s: GridState): GridState {
  // Rebuild maps in reverse insertion order — observably equivalent state.
  const players = new Map(Array.from(s.players.entries()).reverse());
  const cells = new Map(Array.from(s.cells.entries()).reverse());
  return { ...s, players, cells };
}

describe('properties', () => {
  it('1. determinism: same state + same inputs → same hash', () => {
    fc.assert(
      fc.property(stateArb, inputsArb, (s0, seq) => {
        const a = runSequence(s0, seq);
        const b = runSequence(s0, seq);
        return hashState(lastState(a)) === hashState(lastState(b));
      }),
    );
  });

  it('2. replay equivalence: re-running an input log reproduces the trajectory', () => {
    fc.assert(
      fc.property(stateArb, inputsArb, (s0, seq) => {
        const a = runSequence(s0, seq).map(hashState);
        const b = runSequence(s0, seq).map(hashState);
        return a.every((h, i) => h === b[i]);
      }),
    );
  });

  it('3. purity: simulateTick does not mutate prev state or inputs', () => {
    fc.assert(
      fc.property(stateArb, inputsArb, (s0, seq) => {
        const before = hashState(s0);
        runSequence(s0, seq);
        return hashState(s0) === before;
      }),
    );
  });

  it('4. insertion-order independence', () => {
    fc.assert(
      fc.property(stateArb, inputsArb, (s0, seq) => {
        const reordered = reorderMaps(s0);
        const h1 = hashState(lastState(runSequence(s0, seq)));
        const h2 = hashState(lastState(runSequence(reordered, seq)));
        return h1 === h2;
      }),
    );
  });

  it('5. tick monotonicity', () => {
    fc.assert(
      fc.property(stateArb, inputsArb, (s0, seq) => {
        const trajectory = runSequence(s0, seq);
        return trajectory.every((s, i) => s.tick === s0.tick + i);
      }),
    );
  });

  it('6. decay completeness: with no live players, all cells eventually disappear', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 0xffff_ffffn }), (seed) => {
        // Bootstrap a state with cells but no live players: run a 1-player scenario
        // for a few ticks to lay trail, then exit the player and let cells decay.
        let s: GridState = {
          tick: 0,
          config: { ...cfg, seed },
          rng: newRng(seed),
          players: new Map([['p:a', makePlayer('p:a', 4, 4, 1)]]),
          cells: new Map(),
        };
        for (let i = 0; i < 5; i++) {
          s = simulateTick(s, { turns: new Map(), joins: [] });
        }
        // Exit p:a.
        s = simulateTick(s, { turns: new Map([['p:a', 'X']]), joins: [] });
        const initialCellCount = s.cells.size;
        // Step long enough that the oldest cell exceeds 2 * halfLifeTicks.
        for (let i = 0; i < cfg.halfLifeTicks * 2 + 10; i++) {
          s = simulateTick(s, { turns: new Map(), joins: [] });
        }
        return initialCellCount > 0 ? s.cells.size === 0 : true;
      }),
    );
  });
});
