// Peer registry: maps transport session ids to wire-protocol player ids,
// tracks known peers, and determines seniority for joiner sync.
//
// Extracted from client.ts to keep that file under the 400-line cap.
// The registry is a pure data structure with no I/O; the NetClient owns the
// Room and drives all message sends.

import { dbg } from './debug.js';
import type { HelloMsg } from './messages.js';

export interface PeerInfo {
  readonly id: string;
  readonly joinedAt: number;
  readonly color: readonly [number, number, number];
}

export type HelloResult =
  | { kind: 'known' }
  | { kind: 'spoof'; reason: string }
  | { kind: 'new'; peer: PeerInfo; isSenior: boolean };

export class PeerRegistry {
  /** sessionId (transport) → playerId (wire-protocol). Populated by HELLO. */
  readonly sessionToPlayer = new Map<string, string>();
  /** playerId → sessionId. Inverse of sessionToPlayer. */
  readonly playerToSession = new Map<string, string>();
  /** Known peers by player id. */
  readonly peers = new Map<string, PeerInfo>();

  constructor(
    private readonly localId: string,
    private readonly localJoinedAt: number,
  ) {}

  /** Process a HELLO message. Returns the outcome so the caller can act on it. */
  registerHello(msg: HelloMsg, sessionId: string): HelloResult {
    const existingPlayer = this.sessionToPlayer.get(sessionId);
    if (existingPlayer !== undefined && existingPlayer !== msg.from) {
      return {
        kind: 'spoof',
        reason: `HELLO claims "${msg.from}" but session was "${existingPlayer}"`,
      };
    }
    if (this.peers.has(msg.from)) {
      dbg(`peer-registry: ${msg.from} already known`);
      this.sessionToPlayer.set(sessionId, msg.from);
      this.playerToSession.set(msg.from, sessionId);
      return { kind: 'known' };
    }
    dbg(`peer-registry: new peer ${msg.from} session=${sessionId} joinedAt=${msg.joined_at}`);
    this.sessionToPlayer.set(sessionId, msg.from);
    this.playerToSession.set(msg.from, sessionId);
    const peer: PeerInfo = { id: msg.from, joinedAt: msg.joined_at, color: msg.color };
    this.peers.set(msg.from, peer);
    const isSenior =
      msg.joined_at < this.localJoinedAt ||
      (msg.joined_at === this.localJoinedAt && msg.from < this.localId);
    return { kind: 'new', peer, isSenior };
  }

  /** Remove a peer by session id. Returns the player id if found. */
  removeBySession(sessionId: string): string | undefined {
    const playerId = this.sessionToPlayer.get(sessionId);
    this.sessionToPlayer.delete(sessionId);
    if (playerId !== undefined) {
      this.playerToSession.delete(playerId);
      this.peers.delete(playerId);
    }
    return playerId;
  }

  /** Remove a peer by player id. */
  removeByPlayer(playerId: string): void {
    const sessionId = this.playerToSession.get(playerId);
    this.peers.delete(playerId);
    this.playerToSession.delete(playerId);
    if (sessionId !== undefined) this.sessionToPlayer.delete(sessionId);
  }

  /** Get the session id for a player (needed for targeted sends). */
  sessionFor(playerId: string): string | undefined {
    return this.playerToSession.get(playerId);
  }

  /** Resolve a session id to a player id (for anti-spoof validation). */
  playerFor(sessionId: string): string | undefined {
    return this.sessionToPlayer.get(sessionId);
  }

  get size(): number {
    return this.peers.size;
  }
}
