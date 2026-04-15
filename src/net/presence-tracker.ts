// Nostr presence tracker for peer discovery.
//
// Each peer publishes a presence event (kind 20078) every ~3s tagged
// `['x', 'grid:${dayTag}']`. Subscribers filter via `'#x'` to find all peers in
// the day's room. Peers not seen for >15s are considered lost.

import {
  PRESENCE_PUBLISH_INTERVAL_MS,
  PRESENCE_SCAN_INTERVAL_MS,
  PRESENCE_TIMEOUT_MS,
} from './constants.js';
import { dbg } from './debug.js';
import { NOSTR_KIND_PRESENCE, buildRoomPresenceEvent, dayRoomTopic } from './nostr-events.js';
import type { NostrEvent, NostrPool } from './nostr.js';
import type { TileId } from './tile-id.js';

export interface PresenceTrackerDeps {
  readonly pool: NostrPool;
  readonly dayTag: string;
  readonly localPubkey: string;
  /** Optional tile scoping (Stage 13+). When provided, presence is scoped to the
   *  tile's room (`grid:DAY:t:X-Y`) instead of the day's global room (`grid:DAY`).
   *  Peers in different tiles do not see each other. */
  readonly homeTile?: TileId;
  readonly onPeerSeen: (pubkey: string) => void;
  readonly onPeerLost: (pubkey: string) => void;
  /** Injectable for tests. Defaults to `Date.now`. */
  readonly now?: () => number;
  /** Injectable for tests. Defaults to `setInterval`. */
  readonly setIntervalFn?: typeof setInterval;
  /** Injectable for tests. Defaults to `clearInterval`. */
  readonly clearIntervalFn?: typeof clearInterval;
}

export class PresenceTracker {
  private readonly pool: NostrPool;
  private readonly dayTag: string;
  private readonly homeTile: TileId | undefined;
  private readonly topic: string;
  private readonly localPubkey: string;
  private readonly onPeerSeen: (pubkey: string) => void;
  private readonly onPeerLost: (pubkey: string) => void;
  private readonly now: () => number;
  private readonly setIntervalFn: typeof setInterval;
  private readonly clearIntervalFn: typeof clearInterval;

  private readonly lastSeen = new Map<string, number>();
  private subCleanup: (() => void) | null = null;
  private publishTimer: ReturnType<typeof setInterval> | null = null;
  private scanTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(deps: PresenceTrackerDeps) {
    this.pool = deps.pool;
    this.dayTag = deps.dayTag;
    this.homeTile = deps.homeTile;
    this.topic = dayRoomTopic(this.dayTag, this.homeTile);
    this.localPubkey = deps.localPubkey;
    this.onPeerSeen = deps.onPeerSeen;
    this.onPeerLost = deps.onPeerLost;
    this.now = deps.now ?? Date.now;
    this.setIntervalFn = deps.setIntervalFn ?? setInterval;
    this.clearIntervalFn = deps.clearIntervalFn ?? clearInterval;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    dbg(`presence: starting for ${this.topic}`);

    this.subCleanup = this.pool.subscribe(
      {
        kinds: [NOSTR_KIND_PRESENCE],
        '#x': [this.topic],
        since: Math.floor(this.now() / 1000),
      },
      (event) => this.handleEvent(event),
    );

    this.publishOwn();
    this.publishTimer = this.setIntervalFn(() => this.publishOwn(), PRESENCE_PUBLISH_INTERVAL_MS);
    this.scanTimer = this.setIntervalFn(() => this.scanForTimeouts(), PRESENCE_SCAN_INTERVAL_MS);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    dbg('presence: stopping');
    if (this.publishTimer !== null) {
      this.clearIntervalFn(this.publishTimer);
      this.publishTimer = null;
    }
    if (this.scanTimer !== null) {
      this.clearIntervalFn(this.scanTimer);
      this.scanTimer = null;
    }
    if (this.subCleanup !== null) {
      this.subCleanup();
      this.subCleanup = null;
    }
    this.lastSeen.clear();
  }

  /** Snapshot of currently-known peer pubkeys. */
  peers(): ReadonlySet<string> {
    return new Set(this.lastSeen.keys());
  }

  // ---- internal ----

  private publishOwn(): void {
    this.pool.publishFireAndForget(buildRoomPresenceEvent(this.dayTag, this.now(), this.homeTile));
  }

  private handleEvent(event: NostrEvent): void {
    if (event.pubkey === this.localPubkey) return;
    const isNew = !this.lastSeen.has(event.pubkey);
    this.lastSeen.set(event.pubkey, this.now());
    if (isNew) {
      dbg(`presence: peer seen ${event.pubkey.slice(0, 8)}`);
      this.onPeerSeen(event.pubkey);
    }
  }

  private scanForTimeouts(): void {
    const deadline = this.now() - PRESENCE_TIMEOUT_MS;
    const lost: string[] = [];
    for (const [pubkey, ts] of this.lastSeen) {
      if (ts < deadline) lost.push(pubkey);
    }
    for (const pubkey of lost) {
      this.lastSeen.delete(pubkey);
      dbg(`presence: peer lost ${pubkey.slice(0, 8)}`);
      this.onPeerLost(pubkey);
    }
  }
}
