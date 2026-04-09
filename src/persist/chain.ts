// Hash chain for cryptographic integrity of grid state.
//
// Each link chains the previous link's hash with the current state hash and tick:
//   chainHash(n) = SHA-256(prevChainHash || stateHash || tick)
//
// Multiple independent peers publishing the same chainHash for the same tick
// constitutes consensus — the state is authentic. See `docs/architecture/persistence.md`.

import { createHash } from 'node:crypto';
import type { Tick } from '../sim/types.js';

/** Genesis hash — 32 zero bytes. The starting point of every day's chain. */
export const GENESIS_HASH = new Uint8Array(32);

/**
 * Compute the next link in the hash chain.
 *
 * @param prevHash  Previous chain hash (32 bytes), or GENESIS_HASH for the first link.
 * @param stateHash The truncated state hash (hex string, e.g. "a3f8c92b7e1d4f06").
 * @param tick      The simulation tick this link attests.
 */
export function computeChainHash(prevHash: Uint8Array, stateHash: string, tick: Tick): Uint8Array {
  const h = createHash('sha256');
  h.update(prevHash);
  h.update(stateHash, 'utf-8');
  const tickBuf = Buffer.alloc(4);
  tickBuf.writeUInt32LE(tick);
  h.update(tickBuf);
  return new Uint8Array(h.digest());
}
