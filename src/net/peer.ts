// Per-peer bookkeeping carried by the NetClient.
//
// This is a plain data type — no behavior. Behavior lives in `client.ts`,
// `lockstep.ts`, `hashCheck.ts`, and `evict.ts`. Keeping this file pure makes it easy
// to inspect peer state in tests and in the eventual debug HUD.

import type { Tick } from '../sim/index.js';
import type { PeerKind } from './messages.js';

export interface Peer {
  readonly id: string;
  readonly joinedAt: number;
  readonly color: readonly [number, number, number];
  readonly kind: PeerKind;
  readonly client: string;
  /** Tick at which this peer was added to the lockstep (for "expect input from" gating). */
  readonly joinTick: Tick;
  /** Most recent cadence ticks at which this peer broadcast STATE_HASH. */
  readonly hashHistory: Map<Tick, string>;
  /** Consecutive ProtocolError count. Reset on a successful parse. */
  protocolFaults: number;
  /** EVICT votes this peer has cast (per target). */
  evictVotesCast: Set<string>;
  /** True for the local peer. */
  readonly isLocal: boolean;
}

export function makePeer(args: {
  id: string;
  joinedAt: number;
  color: readonly [number, number, number];
  kind: PeerKind;
  client: string;
  joinTick: Tick;
  isLocal: boolean;
}): Peer {
  return {
    id: args.id,
    joinedAt: args.joinedAt,
    color: args.color,
    kind: args.kind,
    client: args.client,
    joinTick: args.joinTick,
    hashHistory: new Map(),
    protocolFaults: 0,
    evictVotesCast: new Set(),
    isLocal: args.isLocal,
  };
}
