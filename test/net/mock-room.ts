// In-process router used by Stage 2 integration tests instead of Trystero.
//
// Multiple `MockRoom` instances created via `MockRoomNetwork.createRoom(localId)`
// share the network. Sending on any one of them broadcasts (or unicasts via `to`)
// to all others. Both `ctrl` and `tick` are delivered synchronously and reliably —
// the production unreliable channel is "lossless" in tests because we don't model
// packet loss; that is exercised separately in `lockstep.test.ts` via timeout paths.

import type { Room, RoomFactory } from '../../src/net/room.js';

type Listener = (raw: string, peerId: string) => void;
type PeerListener = (peerId: string) => void;

interface RoomNode {
  id: string;
  joinListeners: PeerListener[];
  leaveListeners: PeerListener[];
  ctrlListeners: Listener[];
  tickListeners: Listener[];
}

export class MockRoomNetwork {
  private readonly nodes = new Map<string, RoomNode>();

  createRoom(localId: string): Room {
    const node: RoomNode = {
      id: localId,
      joinListeners: [],
      leaveListeners: [],
      ctrlListeners: [],
      tickListeners: [],
    };
    this.nodes.set(localId, node);
    // Notify everyone already in the network of the new arrival, and vice versa.
    for (const other of this.nodes.values()) {
      if (other === node) continue;
      for (const cb of other.joinListeners) cb(localId);
      for (const cb of node.joinListeners) cb(other.id);
    }
    return {
      onPeerJoin: (cb) => {
        node.joinListeners.push(cb);
        for (const other of this.nodes.values()) {
          if (other !== node) cb(other.id);
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
        for (const other of this.nodes.values()) {
          if (other === node) continue;
          if (to !== undefined && other.id !== to) continue;
          for (const cb of other.ctrlListeners) cb(raw, node.id);
        }
      },
      sendTick: (raw) => {
        for (const other of this.nodes.values()) {
          if (other === node) continue;
          for (const cb of other.tickListeners) cb(raw, node.id);
        }
      },
      leave: async () => {
        this.nodes.delete(localId);
        for (const other of this.nodes.values()) {
          for (const cb of other.leaveListeners) cb(localId);
        }
      },
    };
  }

  factory(): RoomFactory {
    return async (_roomKey, localId) => this.createRoom(localId);
  }
}
