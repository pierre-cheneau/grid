// Local player identity derivation.
//
// `${USER}@${HOSTNAME}` per docs/design/identity-and-aesthetic.md, sanitized to a safe
// alphabet, capped at 64 chars. The wire-protocol `from` field uses exactly this string.
//
// Stage 2 simplification: the spec describes a richer identity (machine-id-derived
// color cached in ~/.grid/identity.json). That richer identity is a Persistence stage
// concern. For Stage 2 the colorSeed is derived directly from the id via FNV-1a, which
// is sufficient for the netcode demo.
//
// This file lives outside `src/sim/` because it reads `process.env` and `os.hostname`
// — both forbidden inside the simulation boundary.

import { createHash } from 'node:crypto';
import { hostname, userInfo } from 'node:os';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { fnv1a32 } from './hash.js';

const ID_ALPHABET = /[^A-Za-z0-9._-]/g;
const MAX_ID_LEN = 64;

export interface LocalIdentity {
  /** Wire-protocol `from`. */
  readonly id: string;
  /** u32 color seed used by the renderer. */
  readonly colorSeed: number;
  /** Wall-clock unix seconds at first derivation. Stable for the process lifetime. */
  readonly joinedAt: number;
  /** secp256k1 secret key for Nostr event signing (32 bytes). */
  readonly nostrSeckey: Uint8Array;
  /** Hex-encoded secp256k1 public key (Nostr npub). */
  readonly nostrPubkey: string;
}

/** Generate a fresh secp256k1 keypair for Nostr event signing. */
export function generateNostrKeypair(): { seckey: Uint8Array; pubkey: string } {
  const seckey = generateSecretKey();
  const pubkey = getPublicKey(seckey);
  return { seckey, pubkey };
}

function sanitize(s: string, fallback: string): string {
  const cleaned = (s || fallback).replace(ID_ALPHABET, '_').slice(0, MAX_ID_LEN);
  return cleaned.length > 0 ? cleaned : fallback;
}

/**
 * Derive the local player identity. Reads platform state ONCE per call.
 *
 * `now` is injectable for tests; production passes `Date.now`.
 */
export function deriveLocalId(now: () => number = Date.now): LocalIdentity {
  let user = 'anon';
  try {
    user = userInfo().username;
  } catch {
    // Some sandboxed environments throw on userInfo(); fall back.
  }
  const host = hostname();
  const id = `${sanitize(user, 'anon')}@${sanitize(host, 'localhost')}`.slice(0, MAX_ID_LEN);
  const colorSeed = fnv1a32(id);
  const joinedAt = Math.floor(now() / 1000);
  const { seckey, pubkey } = generateNostrKeypair();
  return { id, colorSeed, joinedAt, nostrSeckey: seckey, nostrPubkey: pubkey };
}

/** Append a suffix to an existing identity. Two terminals on the same machine
 *  with different `--name` flags get distinct colors, spawn positions, AND
 *  distinct secp256k1 network identities — otherwise Stage 10's pubkey-based
 *  peer discovery would collapse them into a single peer and they'd never see
 *  each other's presence events. The rebased keypair is derived deterministically
 *  from `sha256(base.seckey || suffix)` so re-running `--name a` preserves the
 *  same network identity across restarts. */
export function rebaseIdentity(base: LocalIdentity, suffix: string): LocalIdentity {
  const fullId = `${base.id}-${suffix}`;
  const h = createHash('sha256');
  h.update(base.nostrSeckey);
  h.update(suffix, 'utf-8');
  const seckey = new Uint8Array(h.digest());
  const pubkey = getPublicKey(seckey);
  return {
    id: fullId,
    colorSeed: fnv1a32(fullId),
    joinedAt: base.joinedAt,
    nostrSeckey: seckey,
    nostrPubkey: pubkey,
  };
}
