// Nostr publisher for cell snapshots and chain attestations.
//
// Called from the game loop after each tick advance. On cadence ticks (every
// 300 ticks = 30 seconds), encodes and publishes the current cell state as
// signed Nostr events. Periodic publishes are fire-and-forget; final publishes
// (shutdown, midnight) are awaitable so callers can ensure delivery before
// closing the relay pool.

import { dbg } from '../net/debug.js';
import {
  buildCellSnapshotEvent,
  buildChainAttestationEvent,
  buildWorldConfigEvent,
} from '../net/nostr-events.js';
import type { NostrPool } from '../net/nostr.js';
import type { Cell, Config, Tick } from '../sim/types.js';
import { compressSnapshot, encodeSnapshot } from './snapshot.js';
import { partitionByTile } from './tile.js';

/** Publish cell snapshots every 300 ticks (30 seconds at 10 tps). */
export const SNAPSHOT_PUBLISH_CADENCE = 300;

export class NostrPublisher {
  private readonly pool: NostrPool;
  private readonly config: Config;
  private dayTag: string;

  constructor(pool: NostrPool, dayTag: string, config: Config) {
    this.pool = pool;
    this.dayTag = dayTag;
    this.config = config;
  }

  /** Periodic publish: only fires on cadence ticks. Fire-and-forget. */
  onTick(
    tick: Tick,
    cells: ReadonlyMap<string, Cell>,
    stateHash: string,
    chainHash: Uint8Array,
    peerCount: number,
  ): void {
    if (tick % SNAPSHOT_PUBLISH_CADENCE !== 0) return;
    void this.publishSnapshots(tick, cells, stateHash, chainHash, peerCount, 'cadence');
  }

  /** Immediate publish (shutdown, midnight). Returns a promise that resolves when
   *  all publishes have settled — callers should await before closing the pool. */
  async publishNow(
    tick: Tick,
    cells: ReadonlyMap<string, Cell>,
    stateHash: string,
    chainHash: Uint8Array,
    peerCount: number,
  ): Promise<void> {
    await this.publishSnapshots(tick, cells, stateHash, chainHash, peerCount, 'final');
  }

  /** Publish world config event (at midnight reset). Fire-and-forget. */
  publishWorldConfig(width: number, height: number, seed: string, peak?: number): void {
    this.pool.publishFireAndForget(
      buildWorldConfigEvent(this.dayTag, width, height, seed, undefined, peak),
    );
  }

  /** Update the dayTag on midnight reset. */
  resetForNewDay(dayTag: string): void {
    this.dayTag = dayTag;
  }

  // ---- internal ----

  private async publishSnapshots(
    tick: Tick,
    cells: ReadonlyMap<string, Cell>,
    stateHash: string,
    chainHash: Uint8Array,
    peerCount: number,
    label: 'cadence' | 'final',
  ): Promise<void> {
    if (cells.size === 0) return;
    dbg(`nostr-pub: ${label} publish at tick ${tick} (${cells.size} cells)`);

    const tiles = partitionByTile(cells);
    const pending: Promise<void>[] = [];
    for (const { tileX, tileY, cells: tileCells } of tiles) {
      const raw = encodeSnapshot({ tick, config: this.config, cells: tileCells });
      const compressed = compressSnapshot(raw);
      const event = buildCellSnapshotEvent(this.dayTag, tileX, tileY, tick, compressed);
      pending.push(this.pool.publish(event).catch(() => {}));
    }
    const attestation = buildChainAttestationEvent(
      this.dayTag,
      tick,
      stateHash,
      chainHash,
      peerCount,
    );
    pending.push(this.pool.publish(attestation).catch(() => {}));

    await Promise.allSettled(pending);
  }
}
