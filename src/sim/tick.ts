// The public simulation entry point.
//
// `simulateTick(prev, inputs)` is the only function the rest of the codebase needs to
// know about. Given a prior state and a set of inputs for the next tick, it returns a
// fresh `GridState` representing the world at `prev.tick + 1`. The function is pure:
// neither `prev` nor `inputs` is mutated.
//
// Pipeline order (DO NOT REORDER without bumping FORMAT_VERSION and re-pinning every
// hash test in the repo):
//
//   1. Validate tick overflow.
//   2. Compute nextTick = prev.tick + 1.
//   3. Clone the rng (subsequent steps mutate this clone, never `prev.rng`).
//   4. Process exits ('X'): remove leaving players from the player map entirely.
//   5. Process joins: insert new players at fresh spawn cells (consumes rng).
//   6. Apply turns to alive players (functional update of `dir`).
//   7. Compute and resolve moves (collisions, kill credit accounting).
//   8. Award kill credits to trail owners (in sorted order over the derez list).
//   9. Survivors deposit a trail at their PREVIOUS position.
//  10. Decay cells.
//  11. Schedule respawns for newly-derezzed players (respawnAtTick = nextTick + RESPAWN_TICKS).
//  12. Process pending respawns (alive again with fresh pos + dir from rng).
//  13. Construct the next state.
//
// Every step that produces a collection produces a NEW collection. The "previous"
// state references in this function are read-only.

import { TICK_MAX, RESPAWN_TICKS, DIRECTION_COUNT } from './constants.js';
import { decayCells } from './decay.js';
import { applyTurn, cellKey } from './grid.js';
import { sortedEntries, sortedKeys } from './iter.js';
import { resolveMoves } from './movement.js';
import { pickSpawnCell } from './respawn.js';
import { cloneRng, nextRangeU32 } from './rng.js';
import type {
  Cell,
  Direction,
  GridState,
  Inputs,
  Player,
  PlayerId,
  RngState,
} from './types.js';

export function simulateTick(prev: GridState, inputs: Inputs): GridState {
  if (prev.tick >= TICK_MAX) {
    throw new Error(`simulateTick: tick overflow (${prev.tick} >= ${TICK_MAX})`);
  }
  const nextTick = prev.tick + 1;
  const rng: RngState = cloneRng(prev.rng);

  // Step 4 + 6: build the working player map by processing exits and applying turns,
  // in sorted order so any rng consumption that depends on iteration is deterministic.
  // (Stage 1 doesn't consume rng here, but the discipline matters.)
  let players = new Map<PlayerId, Player>();
  for (const [id, player] of sortedEntries(prev.players)) {
    const turn = inputs.turns.get(id) ?? '';
    if (turn === 'X') continue; // exit: drop the player
    if (player.isAlive) {
      players.set(id, { ...player, dir: applyTurn(player.dir, turn) });
    } else {
      players.set(id, player);
    }
  }

  // Step 5: process joins. Each join consumes rng for spawn position.
  // Joins are iterated in input order — the input array is the canonical order.
  for (const join of inputs.joins) {
    if (players.has(join.id)) continue; // duplicate join is a no-op
    const pos = pickSpawnCell(prev.config, prev.cells, players, rng);
    const dir = nextRangeU32(rng, DIRECTION_COUNT) as Direction;
    players.set(join.id, {
      id: join.id,
      pos,
      dir,
      isAlive: true,
      respawnAtTick: null,
      score: 0,
      colorSeed: join.colorSeed,
    });
  }

  // Step 7: resolve movement against the PRIOR cell map (joiners do not collide on
  // their spawn tick — they appear in clear cells already).
  const { moves } = resolveMoves(prev.config, players, prev.cells);

  // Steps 8 + 9: apply move outcomes.
  //   - survivors: update pos, deposit a trail at the PREVIOUS position.
  //   - non-survivors: mark dead, schedule respawn, credit killer.
  // Iterate sorted so kill-credit accumulation is deterministic when one player kills
  // multiple cycles in the same tick.
  const newCells = new Map<string, Cell>();
  // Carry over prior cells; decay runs at step 10 over the merged map.
  for (const [k, c] of sortedEntries(prev.cells)) newCells.set(k, c);

  // Pending score deltas, applied after the move loop so scores update once per tick.
  const scoreDelta = new Map<PlayerId, number>();

  for (const id of sortedKeys(moves)) {
    const m = moves.get(id);
    if (m === undefined) continue;
    const player = players.get(id);
    if (player === undefined) continue;

    if (m.survived) {
      // Deposit a trail at the player's PREVIOUS position.
      const key = cellKey(m.from.x, m.from.y);
      newCells.set(key, {
        type: 'trail',
        ownerId: id,
        createdAtTick: nextTick,
      });
      players.set(id, { ...player, pos: m.to });
    } else {
      // Mark derezzed, schedule respawn.
      players.set(id, {
        ...player,
        isAlive: false,
        respawnAtTick: nextTick + RESPAWN_TICKS,
      });
      if (m.killedBy !== null) {
        scoreDelta.set(m.killedBy, (scoreDelta.get(m.killedBy) ?? 0) + 1);
      }
    }
  }

  // Apply pending score deltas in sorted order. The killer must still exist as a
  // player (they may have been derezzed in the same tick — credit is still awarded).
  for (const id of sortedKeys(scoreDelta)) {
    const player = players.get(id);
    const delta = scoreDelta.get(id);
    if (player === undefined || delta === undefined) continue;
    players.set(id, { ...player, score: player.score + delta });
  }

  // Step 10: decay the merged cell map.
  const decayedCells = decayCells(newCells, nextTick, prev.config.halfLifeTicks);

  // Step 12: process pending respawns. (Step 11 happened inline above when we set
  // respawnAtTick on derezzed players.)
  // A dead player whose respawnAtTick === nextTick is reborn at a fresh spawn cell.
  // Iterate sorted; each respawn consumes rng for position and direction.
  const respawnIds: PlayerId[] = [];
  for (const id of sortedKeys(players)) {
    const p = players.get(id);
    if (p && !p.isAlive && p.respawnAtTick !== null && p.respawnAtTick <= nextTick) {
      respawnIds.push(id);
    }
  }
  for (const id of respawnIds) {
    const p = players.get(id);
    if (p === undefined) continue;
    const pos = pickSpawnCell(prev.config, decayedCells, players, rng);
    const dir = nextRangeU32(rng, DIRECTION_COUNT) as Direction;
    players.set(id, {
      ...p,
      pos,
      dir,
      isAlive: true,
      respawnAtTick: null,
    });
  }

  return {
    tick: nextTick,
    config: prev.config,
    rng,
    players,
    cells: decayedCells,
  };
}
