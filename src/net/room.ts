// Room interface — the transport abstraction NetClient depends on.
//
// A Room manages peer discovery and data channels for a group of peers.
// NetClient talks to the Room interface exclusively; tests inject MockRoom,
// production uses NostrRoom (direct WebRTC + Nostr signaling, Stage 10).

import type { TileId } from './tile-id.js';

export interface Room {
  onPeerJoin(cb: (peerId: string) => void): void;
  onPeerLeave(cb: (peerId: string) => void): void;
  onCtrl(cb: (raw: string, peerId: string) => void): void;
  onTick(cb: (raw: string, peerId: string) => void): void;
  sendCtrl(raw: string, to?: string): void;
  sendTick(raw: string): void;
  leave(): Promise<void>;
}

export interface RoomFactoryOpts {
  readonly relayUrls?: ReadonlyArray<string> | undefined;
}

export type RoomFactory = (
  roomKey: string,
  localPeerId: string,
  opts?: RoomFactoryOpts,
) => Promise<Room>;

/** Stage 15+: NetClient produces one Room per active tile. This signature is
 *  the NetClient-level abstraction over `RoomFactory`; the tile is the only
 *  thing that varies per mesh (localId is constant for a NetClient and is
 *  captured by the closure). */
export type TileRoomFactory = (tile: TileId) => Promise<Room>;
