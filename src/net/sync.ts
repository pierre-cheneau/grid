// Joiner sync. Tracks STATE_REQUESTs we owe a response to and STATE_RESPONSEs we're
// waiting for. The actual room I/O is the NetClient's job; this module is just the
// state machine.

import type { GridState, Tick } from '../sim/index.js';
import type { StateRequestMsg, StateResponseMsg } from './messages.js';
import { decodeSnapshot, encodeSnapshot } from './snapshot.js';

export interface SeniorityCandidate {
  readonly id: string;
  readonly joinedAt: number;
}

/** The most-senior responder is the smallest joinedAt; ties broken by id ascending. */
export function pickResponder(
  candidates: ReadonlyArray<SeniorityCandidate>,
  localId: string,
  localJoinedAt: number,
): string {
  const all: SeniorityCandidate[] = [{ id: localId, joinedAt: localJoinedAt }, ...candidates];
  all.sort((a, b) => {
    if (a.joinedAt !== b.joinedAt) return a.joinedAt - b.joinedAt;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  // Non-empty by construction (localId is always pushed).
  // biome-ignore lint/style/noNonNullAssertion: array is non-empty by construction
  return all[0]!.id;
}

export function buildStateResponse(from: string, to: string, state: GridState): StateResponseMsg {
  return {
    v: 1,
    t: 'STATE_RESPONSE',
    from,
    to,
    tick: state.tick,
    state_b64: encodeSnapshot(state),
  };
}

export function buildStateRequest(from: string): StateRequestMsg {
  return { v: 1, t: 'STATE_REQUEST', from };
}

export function installSnapshot(msg: StateResponseMsg): { state: GridState; tick: Tick } {
  const state = decodeSnapshot(msg.state_b64);
  return { state, tick: state.tick };
}
