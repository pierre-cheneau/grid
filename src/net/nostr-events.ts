// GRID-specific Nostr event builders.
//
// Each function returns an unsigned EventTemplate. The NostrPool signs it
// (Schnorr/BIP-340) before publishing. This separation keeps event construction
// pure and testable without relay connections.

import type { EventTemplate } from './nostr.js';

// Nostr event kind constants for GRID.
// See docs/architecture/persistence.md for the rationale behind each kind range.
export const NOSTR_KIND_WORLD_CONFIG = 30078; // parameterized replaceable
export const NOSTR_KIND_CELL_SNAPSHOT = 30079; // parameterized replaceable
export const NOSTR_KIND_CHAIN_ATTESTATION = 22770; // regular (append-only history)
export const NOSTR_KIND_SIGNALING = 20079; // ephemeral (WebRTC SDP)
export const NOSTR_KIND_PRESENCE = 20078; // ephemeral (player position)

/** Unix seconds from a wall-clock millis value. */
function unixSec(nowMs: number): number {
  return Math.floor(nowMs / 1000);
}

/** Build a world config event for a given day. */
export function buildWorldConfigEvent(
  dayTag: string,
  width: number,
  height: number,
  seed: string,
  now: number = Date.now(),
): EventTemplate {
  return {
    kind: NOSTR_KIND_WORLD_CONFIG,
    tags: [
      ['d', `grid:${dayTag}`],
      ['w', String(width)],
      ['h', String(height)],
      ['seed', seed],
    ],
    content: '',
    created_at: unixSec(now),
  };
}

/** Build a cell snapshot event for a tile. */
export function buildCellSnapshotEvent(
  dayTag: string,
  tileX: number,
  tileY: number,
  tick: number,
  compressedCells: Uint8Array,
  now: number = Date.now(),
): EventTemplate {
  return {
    kind: NOSTR_KIND_CELL_SNAPSHOT,
    tags: [
      ['d', `grid:${dayTag}:t:${tileX}-${tileY}`],
      ['tick', String(tick)],
    ],
    content: Buffer.from(compressedCells).toString('base64'),
    created_at: unixSec(now),
  };
}

/** Build a chain attestation event. */
export function buildChainAttestationEvent(
  dayTag: string,
  tick: number,
  stateHash: string,
  chainHash: Uint8Array,
  peerCount: number,
  now: number = Date.now(),
): EventTemplate {
  return {
    kind: NOSTR_KIND_CHAIN_ATTESTATION,
    tags: [
      ['d', `grid:${dayTag}`],
      ['tick', String(tick)],
      ['sh', stateHash],
      ['ch', Buffer.from(chainHash).toString('hex')],
      ['peers', String(peerCount)],
    ],
    content: '',
    created_at: unixSec(now),
  };
}

/** Build a presence heartbeat event. */
export function buildPresenceEvent(
  dayTag: string,
  tileX: number,
  tileY: number,
  x: number,
  y: number,
  dir: number,
  playerId: string,
  now: number = Date.now(),
): EventTemplate {
  return {
    kind: NOSTR_KIND_PRESENCE,
    tags: [
      ['d', `grid:${dayTag}:p:${tileX}-${tileY}`],
      ['pos', `${x},${y}`],
      ['dir', String(dir)],
      ['pid', playerId],
    ],
    content: '',
    created_at: unixSec(now),
  };
}
