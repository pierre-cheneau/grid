// Nostr-based WebRTC signaling protocol.
//
// Two peers exchange WebRTC SDP offers/answers and ICE candidates by publishing
// signed Nostr ephemeral events (kind 20079) tagged with the target peer's pubkey.
// The receiver subscribes with `'#p': [myPubkey]` to receive only events meant for
// them. This file is pure: no I/O, no node-datachannel, no NostrPool. Tests cover
// 100% of the code paths.

import { NOSTR_KIND_SIGNALING } from './nostr-events.js';
import type { EventTemplate } from './nostr.js';

export type SignalingMessage =
  | { t: 'offer'; sdp: string }
  | { t: 'answer'; sdp: string }
  | { t: 'ice'; candidate: string; mid: string };

/** Build an unsigned Nostr ephemeral event template carrying a signaling message. */
export function buildSignalingEvent(
  targetPubkey: string,
  message: SignalingMessage,
  now: number = Date.now(),
): EventTemplate {
  return {
    kind: NOSTR_KIND_SIGNALING,
    tags: [['p', targetPubkey]],
    content: JSON.stringify(message),
    created_at: Math.floor(now / 1000),
  };
}

/** Parse incoming signaling message from event content. Returns null on malformed. */
export function parseSignalingMessage(content: string): SignalingMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  if (obj['t'] === 'offer' && typeof obj['sdp'] === 'string') {
    return { t: 'offer', sdp: obj['sdp'] };
  }
  if (obj['t'] === 'answer' && typeof obj['sdp'] === 'string') {
    return { t: 'answer', sdp: obj['sdp'] };
  }
  if (
    obj['t'] === 'ice' &&
    typeof obj['candidate'] === 'string' &&
    typeof obj['mid'] === 'string'
  ) {
    return { t: 'ice', candidate: obj['candidate'], mid: obj['mid'] };
  }
  return null;
}

/** Lex-compare pubkeys to determine initiator. Lower pubkey is the initiator.
 *  This is total and deterministic — pubkeys are 64-char hex and unique per peer. */
export function isInitiator(myPubkey: string, peerPubkey: string): boolean {
  return myPubkey < peerPubkey;
}
