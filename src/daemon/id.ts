// Daemon identity derivation.
//
// Daemon player IDs use the format `bot.<name>@<user>.<host>` to pass
// the wire protocol's ID validation regex.

import { DAEMON_PREFIX } from './constants.js';

/** Derive a daemon PlayerId from script basename and host identity. */
export function daemonPlayerId(basename: string, hostId: string): string {
  // hostId is "user@host", we need "user.host" for the right side.
  return `${DAEMON_PREFIX}${basename}@${hostId.replace('@', '.')}`;
}

/** Derive a colorSeed for a daemon from its PlayerId using FNV-1a. */
export function daemonColorSeed(daemonId: string): number {
  let hash = 0x811c_9dc5;
  for (let i = 0; i < daemonId.length; i++) {
    hash ^= daemonId.charCodeAt(i);
    hash = Math.imul(hash, 0x0100_0193);
  }
  return hash >>> 0;
}
