// Extract killer→victim pairs by diffing two consecutive GridState objects.
//
// Pure function, no I/O. Used by the CLI game loop to feed kill attribution
// into DayTracker for the Catalyst crown (distinct victim count).

import type { GridState, PlayerId } from '../sim/types.js';

export interface KillEvent {
  readonly killer: PlayerId;
  readonly victim: PlayerId;
}

/** Diff prev→next states to find who killed whom this tick.
 *  Deaths without a matching killer (out-of-bounds, head-on) are excluded. */
export function extractKills(prev: GridState, next: GridState): readonly KillEvent[] {
  // Find victims: alive in prev, dead in next.
  const victims: PlayerId[] = [];
  for (const [id, p] of next.players) {
    const pp = prev.players.get(id);
    if (pp?.isAlive && !p.isAlive) victims.push(id);
  }
  if (victims.length === 0) return [];

  // Find killers: score increased between prev and next.
  const killers: Array<{ id: PlayerId; delta: number }> = [];
  for (const [id, p] of next.players) {
    const pp = prev.players.get(id);
    if (pp && p.score > pp.score) {
      killers.push({ id, delta: p.score - pp.score });
    }
  }

  // Greedily attribute victims to killers (sorted by ID for determinism).
  victims.sort();
  killers.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const events: KillEvent[] = [];
  let vi = 0;
  for (const k of killers) {
    for (let i = 0; i < k.delta && vi < victims.length; i++, vi++) {
      // biome-ignore lint/style/noNonNullAssertion: vi < victims.length guards this
      events.push({ killer: k.id, victim: victims[vi]! });
    }
  }
  return events;
}
