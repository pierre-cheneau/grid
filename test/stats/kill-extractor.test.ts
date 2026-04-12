import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { newRng } from '../../src/sim/index.js';
import type { Config, GridState, Player } from '../../src/sim/types.js';
import { extractKills } from '../../src/stats/kill-extractor.js';

const CFG: Config = { width: 80, height: 40, halfLifeTicks: 100, seed: 0n, circular: false };

function makePlayer(id: string, alive: boolean, score = 0): Player {
  return {
    id,
    pos: { x: 10, y: 10 },
    dir: 1,
    isAlive: alive,
    respawnAtTick: alive ? null : 100,
    score,
    colorSeed: 0,
  };
}

function makeState(tick: number, players: Player[]): GridState {
  const pm = new Map<string, Player>();
  for (const p of players) pm.set(p.id, p);
  return { tick, config: CFG, rng: newRng(0n), players: pm, cells: new Map() };
}

describe('extractKills', () => {
  it('extracts a single kill', () => {
    const prev = makeState(0, [makePlayer('killer@h', true, 0), makePlayer('victim@h', true, 0)]);
    const next = makeState(1, [
      makePlayer('killer@h', true, 1), // score +1
      makePlayer('victim@h', false, 0), // died
    ]);
    const kills = extractKills(prev, next);
    assert.equal(kills.length, 1);
    assert.equal(kills[0]?.killer, 'killer@h');
    assert.equal(kills[0]?.victim, 'victim@h');
  });

  it('extracts multiple kills by one player', () => {
    const prev = makeState(0, [
      makePlayer('k@h', true, 0),
      makePlayer('v1@h', true, 0),
      makePlayer('v2@h', true, 0),
    ]);
    const next = makeState(1, [
      makePlayer('k@h', true, 2), // score +2
      makePlayer('v1@h', false, 0),
      makePlayer('v2@h', false, 0),
    ]);
    const kills = extractKills(prev, next);
    assert.equal(kills.length, 2);
    assert.ok(kills.every((k) => k.killer === 'k@h'));
  });

  it('returns empty when no deaths', () => {
    const prev = makeState(0, [makePlayer('a@h', true, 0)]);
    const next = makeState(1, [makePlayer('a@h', true, 0)]);
    assert.equal(extractKills(prev, next).length, 0);
  });

  it('ignores deaths without a killer (out-of-bounds)', () => {
    const prev = makeState(0, [makePlayer('a@h', true, 0)]);
    const next = makeState(1, [makePlayer('a@h', false, 0)]); // died, no one got credit
    assert.equal(extractKills(prev, next).length, 0);
  });

  it('handles multiple killers in same tick', () => {
    const prev = makeState(0, [
      makePlayer('k1@h', true, 0),
      makePlayer('k2@h', true, 0),
      makePlayer('v1@h', true, 0),
      makePlayer('v2@h', true, 0),
    ]);
    const next = makeState(1, [
      makePlayer('k1@h', true, 1),
      makePlayer('k2@h', true, 1),
      makePlayer('v1@h', false, 0),
      makePlayer('v2@h', false, 0),
    ]);
    const kills = extractKills(prev, next);
    assert.equal(kills.length, 2);
    // Deterministic: sorted by killer ID, then greedy victim assignment
    const killers = kills.map((k) => k.killer);
    assert.ok(killers.includes('k1@h'));
    assert.ok(killers.includes('k2@h'));
  });

  it('handles new player (not in prev) dying — not a kill', () => {
    const prev = makeState(0, [makePlayer('a@h', true, 0)]);
    const next = makeState(1, [
      makePlayer('a@h', true, 0),
      makePlayer('new@h', false, 0), // new player, immediately dead
    ]);
    // new@h wasn't alive in prev, so not a victim
    assert.equal(extractKills(prev, next).length, 0);
  });

  it('excludes player already dead in prev (not a new death)', () => {
    const prev = makeState(0, [makePlayer('a@h', true, 0), makePlayer('already-dead@h', false, 0)]);
    const next = makeState(1, [
      makePlayer('a@h', true, 0),
      makePlayer('already-dead@h', false, 0), // still dead, not a new death
    ]);
    assert.equal(extractKills(prev, next).length, 0);
  });

  it('handles more score deltas than victims (under-attribution)', () => {
    // 2 killers each got +1, but only 1 victim died
    const prev = makeState(0, [
      makePlayer('k1@h', true, 0),
      makePlayer('k2@h', true, 0),
      makePlayer('v@h', true, 0),
    ]);
    const next = makeState(1, [
      makePlayer('k1@h', true, 1),
      makePlayer('k2@h', true, 1), // score increased but no victim to match
      makePlayer('v@h', false, 0),
    ]);
    const kills = extractKills(prev, next);
    // Only 1 victim available, greedy assigns to first killer
    assert.equal(kills.length, 1);
  });

  it('handles self-kill (killer is also victim)', () => {
    // Player's score increased while they also died (own trail kill)
    const prev = makeState(0, [makePlayer('a@h', true, 0), makePlayer('b@h', true, 0)]);
    const next = makeState(1, [
      makePlayer('a@h', false, 1), // died but also got a kill credit
      makePlayer('b@h', false, 0),
    ]);
    const kills = extractKills(prev, next);
    // a@h killed someone (score +1), both died — greedy attribution applies
    assert.equal(kills.length, 1);
    assert.equal(kills[0]?.killer, 'a@h');
  });
});
