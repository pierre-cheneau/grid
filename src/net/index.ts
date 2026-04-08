// Public API of the network layer.

export { NetClient } from './client.js';
export type { NetClientConfig, NetClientDeps, NetIdentity } from './client.js';
export { ProtocolError } from './messages.js';
export type {
  ByeMsg,
  EvictMsg,
  EvictReason,
  HelloMsg,
  InputMsg,
  KickedMsg,
  Message,
  PeerKind,
  StateHashMsg,
  StateRequestMsg,
  StateResponseMsg,
} from './messages.js';
export { encodeMessage, parseMessage } from './protocol.js';
export type { Room, RoomFactory } from './room.js';
export { createTrysteroRoom } from './room.js';
export { TICK_DURATION_MS, INPUT_TIMEOUT_MS, HASH_INTERVAL_TICKS, MAX_PEERS } from './constants.js';
