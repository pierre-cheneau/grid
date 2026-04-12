// Numeric constants for the network layer.
//
// All wall-clock values live here so the simulation never has to know about them.

import { TICKS_PER_SECOND } from '../sim/index.js';

/** Wire protocol version. Bump invalidates every peer. */
export const PROTOCOL_V = 1 as const;

/** Per-tick wall-clock budget at 10 tps. */
export const TICK_DURATION_MS = Math.round(1000 / TICKS_PER_SECOND); // 100

/** Extra grace period after the tick deadline before we default missing inputs to ''. */
export const INPUT_TIMEOUT_MS = 150;

/** STATE_HASH cadence. Multiples of 30 ticks. */
export const HASH_INTERVAL_TICKS = 30;

/** How many cadence-ticks of hash history we remember per peer. */
export const HASH_HISTORY_DEPTH = 5;

/** Hard cap on a single neighborhood. */
export const MAX_PEERS = 6;

/** Inputs more than this many ticks ahead of the current sim tick are dropped. */
export const MAX_INBOUND_BUFFER_TICKS = 3;

/** A peer that emits this many ProtocolErrors in a row is evicted. */
export const MAX_PROTOCOL_FAULTS = 10;

/** Hard cap on a single non-snapshot message in bytes. */
export const MAX_MESSAGE_BYTES = 16 * 1024;

/** Hard cap on a STATE_RESPONSE message (canonical bytes are well under this). */
export const MAX_SNAPSHOT_MESSAGE_BYTES = 4 * 1024 * 1024;

/** Daily room key prefix. */
export const ROOM_PREFIX = 'grid:';

/** Time to wait for a peer connection before unpausing as the seed player. Overlaps
 *  with the WebRTC handshake (~1.5-2s) and the future intro animation (~1.5s). */
export const SEED_TIMEOUT_MS = 12000;

/** If the wall-clock jumps by more than this between two runOnce calls, the process
 *  was likely frozen (Windows Quick Edit, laptop sleep, debugger breakpoint). The
 *  lockstep should pause and re-sync from the senior peer.
 *
 *  Set high enough to avoid false positives from relay error handling
 *  (rate-limit retries, connection resets) which can stall the Node event loop
 *  for 1-3 seconds. A real user-initiated freeze (click on Windows terminal,
 *  laptop lid close) is typically 5+ seconds. */
export const FREEZE_THRESHOLD_MS = 5000;

/** After this many consecutive ticks where a peer's input was defaulted to '' via
 *  timeout, stop waiting for them entirely (instant default, zero extra wait).
 *  Their cycle drifts straight on autopilot at full 10 tps. Keeps the game fluid
 *  for everyone else. The peer re-syncs via STATE_REQUEST when they recover. */
export const CONSECUTIVE_TIMEOUT_THRESHOLD = 3;

/** WebRTC data channel labels used by `NostrRoom` / `PeerConnection`. */
export const CHANNEL_CTRL = 'ctrl' as const;
export const CHANNEL_TICK = 'tick' as const;

/** Default Nostr relay list. Used by NostrPool for all Nostr interactions
 *  (persistence, signaling, presence). Each relay must accept WebSocket
 *  connections, accept custom event kinds, and not require paid signup. */
export const DEFAULT_RELAYS: readonly string[] = [
  'wss://relay.primal.net',
  'wss://relay.notoshi.win',
  'wss://relay.mostr.pub',
  'wss://relay.nostr.net',
  'wss://nostr.fmt.wiz.biz',
];

/** How often each peer re-announces itself via Nostr presence. */
export const PRESENCE_PUBLISH_INTERVAL_MS = 3000;

/** A peer is considered lost if no presence event is received for this long. */
export const PRESENCE_TIMEOUT_MS = 15000;

/** How often to scan for timed-out peers. */
export const PRESENCE_SCAN_INTERVAL_MS = 5000;
