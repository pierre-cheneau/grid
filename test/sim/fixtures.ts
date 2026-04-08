// Shared test helpers for constructing simple GridState scenarios.

import { newRng } from '../../src/sim/rng.js';
import type { Config, Direction, GridState, Player, PlayerId } from '../../src/sim/types.js';

export function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    width: 16,
    height: 16,
    halfLifeTicks: 30,
    seed: 0n,
    ...overrides,
  };
}

export function makePlayer(
  id: PlayerId,
  x: number,
  y: number,
  dir: Direction,
  overrides: Partial<Player> = {},
): Player {
  return {
    id,
    pos: { x, y },
    dir,
    isAlive: true,
    respawnAtTick: null,
    score: 0,
    colorSeed: 0,
    ...overrides,
  };
}

export function emptyState(cfg: Config = makeConfig()): GridState {
  return {
    tick: 0,
    config: cfg,
    rng: newRng(cfg.seed),
    players: new Map(),
    cells: new Map(),
  };
}

export function withPlayers(state: GridState, players: Player[]): GridState {
  const map = new Map<PlayerId, Player>();
  for (const p of players) map.set(p.id, p);
  return { ...state, players: map };
}
