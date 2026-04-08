// Canonical state hash.
//
// THIS IS THE ONLY FILE IN `src/sim/` ALLOWED TO IMPORT FROM `node:`.
// The boundary checker (`scripts/check-sim-boundary.ts`) has a single-file allowlist
// for `node:crypto` and will fail the build if any other file under `src/sim/` imports
// a `node:` module.
//
// Why this is allowed: `createHash('sha256')` is pure CPU computation. It performs no
// I/O, reads no environment, has no clock or randomness, and is bit-standardized
// across every Node platform. The only alternative is vendoring ~150 lines of pure-JS
// SHA-256 bit-twiddling, which is itself a determinism risk and a maintenance tax. The
// future Python port will use `hashlib.sha256` for the same reason.
//
// The hash is truncated to 64 bits (16 hex chars). 64 bits is enough for an opaque
// state fingerprint at human-scale game state counts; it keeps log lines short and
// makes hash mismatches easy to eyeball in CI output.

import { createHash } from 'node:crypto';
import { canonicalBytes } from './serialize.js';
import type { GridState } from './types.js';

/**
 * Return the canonical 64-bit hash of `state` as a 16-char lowercase hex string.
 *
 * Two `GridState` values are considered equivalent for replay purposes iff their
 * `hashState` outputs are equal. Insertion order, allocation identity, and any other
 * non-canonical aspect of the input is irrelevant by construction.
 */
export function hashState(state: GridState): string {
  const bytes = canonicalBytes(state);
  const digest = createHash('sha256').update(bytes).digest();
  return digest.subarray(0, 8).toString('hex');
}
