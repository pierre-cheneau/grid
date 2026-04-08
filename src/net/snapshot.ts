// Base64 wrapper around the canonical byte serializer for STATE_RESPONSE payloads.
//
// Why base64 of canonicalBytes instead of a JSON state object: a JSON object would
// lose information for the u64 RNG state (JS numbers can't represent it precisely)
// and for Map iteration order. The canonical byte format is the single source of truth
// for both hashing and replay; this file is the thin transport adapter.

import { type GridState, canonicalBytes, parseCanonicalBytes } from '../sim/index.js';

export function encodeSnapshot(state: GridState): string {
  const bytes = canonicalBytes(state);
  return Buffer.from(bytes).toString('base64');
}

export function decodeSnapshot(b64: string): GridState {
  const buf = Buffer.from(b64, 'base64');
  return parseCanonicalBytes(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
}
