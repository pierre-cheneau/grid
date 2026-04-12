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
export { NostrPool } from './nostr.js';
export type { NostrPoolConfig, NostrEvent, EventTemplate, Filter } from './nostr.js';
export {
  NOSTR_KIND_WORLD_CONFIG,
  NOSTR_KIND_CELL_SNAPSHOT,
  NOSTR_KIND_CHAIN_ATTESTATION,
  NOSTR_KIND_SIGNALING,
  NOSTR_KIND_PRESENCE,
  buildWorldConfigEvent,
  buildCellSnapshotEvent,
  buildChainAttestationEvent,
  buildPresenceEvent,
} from './nostr-events.js';
export type { Room, RoomFactory } from './room.js';
export { NostrRoom, createNostrRoom } from './nostr-room.js';
export type { NostrRoomConfig, PeerConnectionFactory } from './nostr-room.js';
export { TICK_DURATION_MS, INPUT_TIMEOUT_MS, HASH_INTERVAL_TICKS, MAX_PEERS } from './constants.js';
export { dayStartMs, seedFromDay, tickAtTime, todayTag } from './time.js';
