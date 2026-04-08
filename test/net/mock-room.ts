// In-process router used by Stage 5+ integration tests instead of Trystero.
//
// Multiple `MockRoom` instances created via `MockRoomNetwork.createRoom(localPlayerId)`
// share the network. CRITICALLY, each room is assigned an **opaque "trystero-like"
// session id** that is different from the player id. The sender parameter passed to
// inbound listeners is this opaque id, NOT the player id — exactly mirroring how
// real Trystero peer ids work.
//
// This is the discipline that makes the in-process tests catch the
// sender/from-namespace bug that bit Stage 5 in production: if a test treats the
// sender as a player id, it will fail in CI for the same reason real Trystero
// connections fail.

import type { Room, RoomFactory } from '../../src/net/room.js';

type Listener = (raw: string, sessionId: string) => void;
type PeerListener = (sessionId: string) => void;

interface RoomNode {
  /** Opaque per-session id; unique per createRoom call. NEVER equals a player id. */
  readonly sessionId: string;
  /** The player id passed to createRoom. Stored only so leave() can be debugged. */
  readonly playerId: string;
  joinListeners: PeerListener[];
  leaveListeners: PeerListener[];
  ctrlListeners: Listener[];
  tickListeners: Listener[];
}

export class MockRoomNetwork {
  private readonly nodes = new Map<string, RoomNode>(); // keyed by sessionId
  private nextSessionSeq = 0;

  /**
   * `localPlayerId` is the wire-protocol player id (what HELLO carries in `from`).
   * The returned Room exposes opaque session ids — callers must NEVER assume the
   * sender parameter equals the player id.
   */
  createRoom(localPlayerId: string): Room {
    const sessionId = `mock-session-${this.nextSessionSeq++}`;
    const node: RoomNode = {
      sessionId,
      playerId: localPlayerId,
      joinListeners: [],
      leaveListeners: [],
      ctrlListeners: [],
      tickListeners: [],
    };
    this.nodes.set(sessionId, node);
    // Notify the existing peers synchronously. They have listeners registered
    // because they finished start() earlier. The new peer's listener-registration
    // happens after createRoom returns; the `onPeerJoin` setter below replays
    // existing peers so the new peer also sees them. The NetClient self-heal in
    // handleHelloFromSession then re-broadcasts HELLO if any first-broadcast was
    // dropped due to listener races.
    for (const other of this.nodes.values()) {
      if (other === node) continue;
      for (const cb of other.joinListeners) cb(sessionId);
    }
    return {
      onPeerJoin: (cb) => {
        node.joinListeners.push(cb);
        for (const other of this.nodes.values()) {
          if (other !== node) cb(other.sessionId);
        }
      },
      onPeerLeave: (cb) => {
        node.leaveListeners.push(cb);
      },
      onCtrl: (cb) => {
        node.ctrlListeners.push(cb);
      },
      onTick: (cb) => {
        node.tickListeners.push(cb);
      },
      sendCtrl: (raw, to) => {
        // `to` is a session id (the namespace the network actually routes by).
        for (const other of this.nodes.values()) {
          if (other === node) continue;
          if (to !== undefined && other.sessionId !== to) continue;
          for (const cb of other.ctrlListeners) cb(raw, node.sessionId);
        }
      },
      sendTick: (raw) => {
        for (const other of this.nodes.values()) {
          if (other === node) continue;
          for (const cb of other.tickListeners) cb(raw, node.sessionId);
        }
      },
      leave: async () => {
        this.nodes.delete(sessionId);
        for (const other of this.nodes.values()) {
          for (const cb of other.leaveListeners) cb(sessionId);
        }
      },
    };
  }

  factory(): RoomFactory {
    return async (_roomKey, localPlayerId) => this.createRoom(localPlayerId);
  }
}
