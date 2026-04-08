// The wire-protocol message discriminated union.
//
// Mirrors `docs/protocol/wire-protocol.md` exactly. Every type carries `v`, `t`, and
// `from`, plus its type-specific fields. Anything new added here also needs a parser
// branch in `protocol.ts`.

import type { Tick, Turn } from '../sim/index.js';

export type EvictReason = 'hash_mismatch' | 'timeout' | 'disconnect';
export type PeerKind = 'pilot' | 'daemon';

export interface HelloMsg {
  readonly v: 1;
  readonly t: 'HELLO';
  readonly from: string;
  readonly color: readonly [number, number, number];
  readonly kind: PeerKind;
  readonly client: string;
  readonly joined_at: number;
}

export interface InputMsg {
  readonly v: 1;
  readonly t: 'INPUT';
  readonly from: string;
  readonly tick: Tick;
  readonly i: Turn;
}

export interface StateHashMsg {
  readonly v: 1;
  readonly t: 'STATE_HASH';
  readonly from: string;
  readonly tick: Tick;
  readonly h: string;
}

export interface EvictMsg {
  readonly v: 1;
  readonly t: 'EVICT';
  readonly from: string;
  readonly target: string;
  readonly reason: EvictReason;
  readonly tick: Tick;
}

export interface StateRequestMsg {
  readonly v: 1;
  readonly t: 'STATE_REQUEST';
  readonly from: string;
}

export interface StateResponseMsg {
  readonly v: 1;
  readonly t: 'STATE_RESPONSE';
  readonly from: string;
  readonly to: string;
  readonly tick: Tick;
  readonly state_b64: string;
}

export interface KickedMsg {
  readonly v: 1;
  readonly t: 'KICKED';
  readonly from: string;
  readonly to: string;
  readonly reason: EvictReason;
}

export interface ByeMsg {
  readonly v: 1;
  readonly t: 'BYE';
  readonly from: string;
}

export type Message =
  | HelloMsg
  | InputMsg
  | StateHashMsg
  | EvictMsg
  | StateRequestMsg
  | StateResponseMsg
  | KickedMsg
  | ByeMsg;

export type MessageType = Message['t'];

export class ProtocolError extends Error {
  constructor(message: string) {
    super(`ProtocolError: ${message}`);
    this.name = 'ProtocolError';
  }
}
