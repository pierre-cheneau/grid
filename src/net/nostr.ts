// Nostr relay pool — thin wrapper around nostr-tools SimplePool.
//
// Manages connections to multiple Nostr relays for publishing signed events,
// subscribing to event streams, and one-shot queries. All events are signed
// with the local identity's secp256k1 keypair (Schnorr/BIP-340).
//
// This is the ONLY file in the codebase that imports from `nostr-tools`
// (except `src/id/identity.ts` which imports key generation from `nostr-tools/pure`).

import type { EventTemplate, Event as NostrEvent, VerifiedEvent } from 'nostr-tools/core';
import type { Filter } from 'nostr-tools/filter';
import { SimplePool } from 'nostr-tools/pool';
import { finalizeEvent, verifyEvent } from 'nostr-tools/pure';
import { DEFAULT_RELAYS } from './constants.js';
import { dbg } from './debug.js';

export type { NostrEvent, EventTemplate, Filter, VerifiedEvent };

export interface NostrPoolConfig {
  readonly relayUrls?: ReadonlyArray<string>;
  readonly seckey: Uint8Array;
  readonly pubkey: string;
}

interface SubHandle {
  close(): void;
}

export class NostrPool {
  private readonly pool: SimplePool;
  private readonly relays: string[];
  private readonly seckey: Uint8Array;
  private readonly activeSubs: Set<SubHandle> = new Set();
  readonly pubkey: string;

  constructor(config: NostrPoolConfig) {
    this.pool = new SimplePool();
    this.relays = config.relayUrls?.length ? [...config.relayUrls] : [...DEFAULT_RELAYS];
    this.seckey = config.seckey;
    this.pubkey = config.pubkey;
    dbg(
      `nostr: pool created with ${this.relays.length} relays, pubkey=${this.pubkey.slice(0, 8)}…`,
    );
  }

  /** Sign and publish an event to all relays. */
  async publish(template: EventTemplate): Promise<void> {
    const signed = finalizeEvent(template, this.seckey);
    dbg(`nostr: publish kind=${signed.kind} id=${signed.id.slice(0, 8)}…`);
    const results = await Promise.allSettled(this.pool.publish(this.relays, signed));
    const accepted = results.filter((r) => r.status === 'fulfilled').length;
    if (accepted === 0) {
      dbg(`nostr: publish FAILED — 0/${results.length} relays accepted kind=${signed.kind}`);
    }
  }

  /** Subscribe to events matching a filter. Returns a cleanup function. */
  subscribe(filter: Filter, onEvent: (event: NostrEvent) => void): () => void {
    dbg(`nostr: subscribe filter=${JSON.stringify(filter).slice(0, 100)}`);
    const sub = this.pool.subscribeMany(this.relays, filter, { onevent: onEvent });
    this.activeSubs.add(sub);
    return () => {
      sub.close();
      this.activeSubs.delete(sub);
    };
  }

  /** Fetch all events matching a filter (one-shot query). */
  async fetch(filter: Filter): Promise<NostrEvent[]> {
    dbg(`nostr: fetch filter=${JSON.stringify(filter).slice(0, 100)}`);
    return this.pool.querySync(this.relays, filter);
  }

  /** Verify a received event's Schnorr signature. */
  verify(event: NostrEvent): boolean {
    return verifyEvent(event);
  }

  /** Close all active subscriptions and relay connections. */
  close(): void {
    dbg(`nostr: closing pool (${this.activeSubs.size} active subs)`);
    for (const sub of this.activeSubs) sub.close();
    this.activeSubs.clear();
    this.pool.close(this.relays);
  }
}
