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

/** Trystero channel labels. */
export const CHANNEL_CTRL = 'ctrl' as const;
export const CHANNEL_TICK = 'tick' as const;
