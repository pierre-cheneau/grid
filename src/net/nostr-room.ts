// NostrRoom — direct WebRTC mesh over Nostr signaling.
//
// Implements the Room interface on top of:
//   - NostrPool for relay communication
//   - PresenceTracker for peer discovery via kind 20078
//   - NostrSignaling for SDP/ICE exchange via kind 20079
//   - PeerConnection for per-peer WebRTC + ctrl/tick data channels
//
// Session ID = peer pubkey. PeerRegistry maps pubkey → playerId via HELLO.
// Every discovered peer forms a WebRTC connection; all connected peers are
// in lockstep together.

import { dbg } from './debug.js';
import { NOSTR_KIND_SIGNALING } from './nostr-events.js';
import {
  type SignalingMessage,
  buildSignalingEvent,
  isInitiator,
  parseSignalingMessage,
} from './nostr-signaling.js';
import type { NostrEvent, NostrPool } from './nostr.js';
import { PeerConnection, type PeerConnectionDeps } from './peer-connection.js';
import { PresenceTracker } from './presence-tracker.js';
import type { Room } from './room.js';
import type { TileId } from './tile-id.js';

type Listener<T extends unknown[]> = (...args: T) => void;

export type PeerConnectionFactory = (deps: PeerConnectionDeps) => PeerConnection;

export interface NostrRoomConfig {
  readonly pool: NostrPool;
  readonly dayTag: string;
  readonly localPubkey: string;
  /** Optional tile scoping (Stage 13+). When provided, peer discovery is restricted
   *  to other peers in the same tile. Without it, behavior matches v0.2 (day-level). */
  readonly homeTile?: TileId;
  /** Optional PeerConnection factory for tests. Defaults to `new PeerConnection(deps)`. */
  readonly peerConnectionFactory?: PeerConnectionFactory;
}

export class NostrRoom implements Room {
  private readonly pool: NostrPool;
  private readonly dayTag: string;
  private readonly localPubkey: string;
  private readonly createPeer: PeerConnectionFactory;
  private readonly presenceTracker: PresenceTracker;

  private readonly connections = new Map<string, PeerConnection>();
  private signalingCleanup: (() => void) | null = null;

  private readonly joinCbs: Array<Listener<[string]>> = [];
  private readonly leaveCbs: Array<Listener<[string]>> = [];
  private readonly ctrlCbs: Array<Listener<[string, string]>> = [];
  private readonly tickCbs: Array<Listener<[string, string]>> = [];

  constructor(config: NostrRoomConfig) {
    this.pool = config.pool;
    this.dayTag = config.dayTag;
    this.localPubkey = config.localPubkey;
    this.createPeer = config.peerConnectionFactory ?? ((deps) => new PeerConnection(deps));
    this.presenceTracker = new PresenceTracker({
      pool: this.pool,
      dayTag: this.dayTag,
      localPubkey: this.localPubkey,
      onPeerSeen: (pk) => this.handlePeerSeen(pk),
      onPeerLost: (pk) => this.handlePeerLost(pk),
      ...(config.homeTile !== undefined ? { homeTile: config.homeTile } : {}),
    });
    this.start();
  }

  // ---- Room interface ----

  onPeerJoin(cb: (peerId: string) => void): void {
    this.joinCbs.push(cb);
  }

  onPeerLeave(cb: (peerId: string) => void): void {
    this.leaveCbs.push(cb);
  }

  onCtrl(cb: (raw: string, peerId: string) => void): void {
    this.ctrlCbs.push(cb);
  }

  onTick(cb: (raw: string, peerId: string) => void): void {
    this.tickCbs.push(cb);
  }

  sendCtrl(raw: string, to?: string): void {
    if (to !== undefined) {
      this.connections.get(to)?.sendCtrl(raw);
      return;
    }
    for (const conn of this.connections.values()) conn.sendCtrl(raw);
  }

  sendTick(raw: string): void {
    for (const conn of this.connections.values()) conn.sendTick(raw);
  }

  async leave(): Promise<void> {
    dbg('nostr-room: leaving');
    this.presenceTracker.stop();
    if (this.signalingCleanup !== null) {
      this.signalingCleanup();
      this.signalingCleanup = null;
    }
    for (const conn of this.connections.values()) conn.close();
    this.connections.clear();
  }

  // ---- internal ----

  private start(): void {
    dbg(`nostr-room: starting for ${this.dayTag}`);
    this.signalingCleanup = this.pool.subscribe(
      {
        kinds: [NOSTR_KIND_SIGNALING],
        '#p': [this.localPubkey],
        since: Math.floor(Date.now() / 1000),
      },
      (event) => this.handleSignalingEvent(event),
    );
    this.presenceTracker.start();
  }

  private handlePeerSeen(remotePubkey: string): void {
    if (this.connections.has(remotePubkey)) return;
    if (!isInitiator(this.localPubkey, remotePubkey)) {
      // Wait for their offer to arrive via signaling.
      return;
    }
    dbg(`nostr-room: initiating ${remotePubkey.slice(0, 8)}`);
    this.createAndRegisterPeer(remotePubkey, true);
  }

  private handlePeerLost(remotePubkey: string): void {
    const conn = this.connections.get(remotePubkey);
    if (conn !== undefined) {
      dbg(`nostr-room: peer lost ${remotePubkey.slice(0, 8)} — closing connection`);
      conn.close();
    }
  }

  private handleSignalingEvent(event: NostrEvent): void {
    if (event.pubkey === this.localPubkey) return;
    if (!this.pool.verify(event)) {
      dbg(`nostr-room: bad signature on signaling event from ${event.pubkey.slice(0, 8)}`);
      return;
    }
    const msg = parseSignalingMessage(event.content);
    if (msg === null) return;

    let peer = this.connections.get(event.pubkey);
    if (peer === undefined) {
      if (msg.t !== 'offer') {
        // No connection yet and message is answer/ice — stale or out-of-order. Drop.
        return;
      }
      dbg(`nostr-room: receiving offer from ${event.pubkey.slice(0, 8)}`);
      peer = this.createAndRegisterPeer(event.pubkey, false);
    }
    void peer.receiveSignaling(msg);
  }

  private createAndRegisterPeer(remotePubkey: string, initiatorRole: boolean): PeerConnection {
    const peer = this.createPeer({
      remotePubkey,
      isInitiator: initiatorRole,
      sendSignaling: (msg: SignalingMessage) => {
        this.pool.publishFireAndForget(buildSignalingEvent(remotePubkey, msg));
      },
      onCtrlMessage: (raw) => {
        for (const cb of this.ctrlCbs) cb(raw, remotePubkey);
      },
      onTickMessage: (raw) => {
        for (const cb of this.tickCbs) cb(raw, remotePubkey);
      },
      onOpen: () => {
        dbg(`nostr-room: peer ${remotePubkey.slice(0, 8)} open`);
        for (const cb of this.joinCbs) cb(remotePubkey);
      },
      onClose: () => {
        this.connections.delete(remotePubkey);
        for (const cb of this.leaveCbs) cb(remotePubkey);
      },
    });
    this.connections.set(remotePubkey, peer);
    return peer;
  }
}

export function createNostrRoom(config: NostrRoomConfig): NostrRoom {
  return new NostrRoom(config);
}
