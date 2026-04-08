// State-hash cross-check.
//
// Every HASH_INTERVAL_TICKS the parent NetClient calls `recordOwn(tick, hash)` and
// receives STATE_HASH messages from peers via `recordRemote(msg)`. When a cadence tick
// has hashes from at least 2 peers, the tracker classifies the hashes into majority
// and minority groups. Any peer in a minority group is a desync candidate; the parent
// then broadcasts EVICT against them.

import type { Tick } from '../sim/index.js';
import { HASH_HISTORY_DEPTH, HASH_INTERVAL_TICKS } from './constants.js';
import type { StateHashMsg } from './messages.js';

export interface DesyncReport {
  readonly tick: Tick;
  readonly minority: ReadonlyArray<string>;
  readonly majorityHash: string;
}

export class HashCheck {
  // tick → peerId → hash
  private readonly perTick = new Map<Tick, Map<string, string>>();

  static isCadenceTick(tick: Tick): boolean {
    return tick > 0 && tick % HASH_INTERVAL_TICKS === 0;
  }

  recordOwn(tick: Tick, hash: string, localId: string): void {
    this.set(tick, localId, hash);
  }

  recordRemote(msg: StateHashMsg): void {
    this.set(msg.tick, msg.from, msg.h);
  }

  private set(tick: Tick, peerId: string, hash: string): void {
    let m = this.perTick.get(tick);
    if (m === undefined) {
      m = new Map();
      this.perTick.set(tick, m);
    }
    m.set(peerId, hash);
    this.evictOldHistory();
  }

  private evictOldHistory(): void {
    while (this.perTick.size > HASH_HISTORY_DEPTH) {
      const oldest = [...this.perTick.keys()].sort((a, b) => a - b)[0];
      if (oldest === undefined) return;
      this.perTick.delete(oldest);
    }
  }

  /** Inspect the entries for `tick`. If at least 2 peers reported and a strict
   *  minority disagrees with the most-frequent hash, return the desync report. */
  classify(tick: Tick): DesyncReport | null {
    const m = this.perTick.get(tick);
    if (m === undefined || m.size < 2) return null;
    const counts = new Map<string, string[]>();
    for (const [peerId, hash] of m) {
      const arr = counts.get(hash) ?? [];
      arr.push(peerId);
      counts.set(hash, arr);
    }
    if (counts.size < 2) return null; // all agree
    // Find the largest group; the rest are minorities.
    let majorityHash = '';
    let majoritySize = 0;
    for (const [hash, peers] of counts) {
      if (peers.length > majoritySize) {
        majorityHash = hash;
        majoritySize = peers.length;
      }
    }
    const minority: string[] = [];
    for (const [hash, peers] of counts) {
      if (hash === majorityHash) continue;
      minority.push(...peers);
    }
    minority.sort();
    return { tick, minority, majorityHash };
  }
}
