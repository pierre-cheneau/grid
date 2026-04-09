// Eviction vote tally.
//
// Per `wire-protocol.md` §117: a peer is evicted when a strict majority of the
// REMAINING peers (excluding the target) have voted EVICT against the same target.
// "Strict majority" of N peers = floor(N/2) + 1 votes.
//
// We tally votes per (target, reason). We don't currently consolidate across reasons —
// the spec lets a peer be evicted for whichever reason hits quorum first.

import type { EvictMsg, EvictReason } from './messages.js';

export interface EvictDecision {
  readonly target: string;
  readonly reason: EvictReason;
  readonly voters: ReadonlyArray<string>;
}

/** Strict-majority threshold: > N/2, i.e. floor(N/2) + 1. */
export function quorum(remainingPeerCount: number): number {
  return Math.floor(remainingPeerCount / 2) + 1;
}

export class EvictionTracker {
  // target -> reason -> Set<voter>
  private readonly votes = new Map<string, Map<EvictReason, Set<string>>>();
  private readonly evicted = new Set<string>();

  /** Record an EVICT message. Returns the decision iff quorum is now reached. */
  record(msg: EvictMsg, totalPeerCount: number): EvictDecision | null {
    if (this.evicted.has(msg.target)) return null;
    let perReason = this.votes.get(msg.target);
    if (perReason === undefined) {
      perReason = new Map();
      this.votes.set(msg.target, perReason);
    }
    let voters = perReason.get(msg.reason);
    if (voters === undefined) {
      voters = new Set();
      perReason.set(msg.reason, voters);
    }
    if (msg.from === msg.target) return null; // self-vote ignored
    voters.add(msg.from);
    const remaining = totalPeerCount - 1; // exclude target
    if (remaining <= 0) return null;
    if (voters.size >= quorum(remaining)) {
      this.evicted.add(msg.target);
      return {
        target: msg.target,
        reason: msg.reason,
        voters: [...voters].sort(),
      };
    }
    return null;
  }

  /** Forget a peer entirely (e.g. they sent BYE). */
  forget(peerId: string): void {
    this.votes.delete(peerId);
    this.evicted.delete(peerId);
    // Also remove their votes against others.
    for (const perReason of this.votes.values()) {
      for (const voters of perReason.values()) {
        voters.delete(peerId);
      }
    }
  }

  /** Clear all votes and evictions (used after midnight reset). */
  clear(): void {
    this.votes.clear();
    this.evicted.clear();
  }

  isEvicted(peerId: string): boolean {
    return this.evicted.has(peerId);
  }
}
