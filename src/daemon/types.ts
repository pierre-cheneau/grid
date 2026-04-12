// Daemon-side protocol message types.
//
// These are the messages exchanged between the GRID client and a daemon process
// over stdin/stdout (subprocess) or parentPort (worker). Separate from the
// peer-to-peer wire protocol types in `src/net/messages.ts`.

import type { Turn } from '../sim/types.js';

/** Client → Daemon: initial handshake. */
export interface DaemonHello {
  readonly t: 'HELLO';
  readonly v: 1;
  readonly you: string;
  readonly tick_ms: number;
  readonly config: { readonly grid_w: number; readonly grid_h: number };
}

/** Daemon → Client: handshake acknowledgement. */
export interface DaemonHelloAck {
  readonly t: 'HELLO_ACK';
  readonly v: 1;
  readonly name: string;
  readonly author: string;
  readonly version: string;
}

/** Client → Daemon: per-tick game state. */
export interface DaemonTick {
  readonly t: 'TICK';
  readonly n: number;
  readonly you: DaemonSelf;
  readonly others: readonly DaemonOther[];
  readonly cells: readonly DaemonCell[];
}

export interface DaemonSelf {
  readonly x: number;
  readonly y: number;
  readonly dir: 'N' | 'E' | 'S' | 'W';
  readonly alive: boolean;
  readonly score: number;
}

export interface DaemonOther {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly dir: 'N' | 'E' | 'S' | 'W';
  readonly alive: boolean;
}

export interface DaemonCell {
  readonly x: number;
  readonly y: number;
  readonly type: string;
  readonly owner: string;
  readonly age: number;
}

/** Daemon → Client: per-tick command response. */
export interface DaemonCmd {
  readonly t: 'CMD';
  readonly n: number;
  readonly i: Turn;
}
