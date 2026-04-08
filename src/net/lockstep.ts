// The lockstep input buffer + tick advancer.
//
// Owns:
//   - the current GridState
//   - the per-tick input buffer (Map<Tick, Map<PeerId, Turn>>)
//   - the set of peers we expect inputs from
//   - the wall-clock deadline for the current pending tick
//
// The advancer is pull-driven: the parent NetClient calls `advanceIfReady(now)` from
// a 10ms scheduler. The advancer either:
//   1. Has all expected peers' inputs for the current pending tick → advance, return state.
//   2. Has not yet reached the per-tick deadline → return null.
//   3. Has reached the deadline → fill missing peers with '', flag them, advance, return state.
//
// Joins and exits are queued separately and injected into the very next tick's Inputs.

import {
  type Config,
  type GridState,
  type Inputs,
  type JoinRequest,
  type PlayerId,
  TICK_MAX,
  type Tick,
  type Turn,
  simulateTick,
} from '../sim/index.js';
import { INPUT_TIMEOUT_MS, MAX_INBOUND_BUFFER_TICKS, TICK_DURATION_MS } from './constants.js';
import type { InputMsg } from './messages.js';

export interface LockstepDeps {
  readonly localId: PlayerId;
  readonly initialState: GridState;
  readonly clock: () => number;
}

export interface AdvanceResult {
  readonly state: GridState;
  /** Peer ids whose input was missing at the deadline and was defaulted to ''. */
  readonly missing: ReadonlyArray<PlayerId>;
}

export class Lockstep {
  private state: GridState;
  private nextTick: Tick;
  private readonly buffer = new Map<Tick, Map<PlayerId, Turn>>();
  private readonly peers = new Set<PlayerId>();
  private readonly pendingJoins: JoinRequest[] = [];
  private readonly pendingExits = new Set<PlayerId>();
  private localPending: Turn = '';
  /** Wall-clock at which the current `nextTick` started waiting for inputs. */
  private tickDeadlineStartedAt: number;

  constructor(private readonly deps: LockstepDeps) {
    this.state = deps.initialState;
    this.nextTick = deps.initialState.tick + 1;
    this.tickDeadlineStartedAt = deps.clock();
    // The local peer is always expected.
    this.peers.add(deps.localId);
  }

  get currentState(): GridState {
    return this.state;
  }

  /** Replace the entire state (used by joiner sync to install a snapshot). */
  reset(state: GridState): void {
    this.state = state;
    this.nextTick = state.tick + 1;
    this.buffer.clear();
    this.pendingJoins.length = 0;
    this.pendingExits.clear();
    this.localPending = '';
    this.tickDeadlineStartedAt = this.deps.clock();
  }

  get currentTick(): Tick {
    return this.state.tick;
  }

  get config(): Config {
    return this.state.config;
  }

  get expectedPeers(): ReadonlySet<PlayerId> {
    return this.peers;
  }

  /** Add a peer to the expected set. They begin contributing inputs from `nextTick`. */
  addPeer(id: PlayerId): void {
    this.peers.add(id);
  }

  /** Stop expecting inputs from this peer and queue them for removal from the sim. */
  removePeer(id: PlayerId): void {
    this.peers.delete(id);
    this.pendingExits.add(id);
    // Drop any buffered inputs from this peer.
    for (const turns of this.buffer.values()) {
      turns.delete(id);
    }
  }

  /** Queue a JoinRequest to be injected at the next tick. */
  queueJoin(req: JoinRequest): void {
    this.pendingJoins.push(req);
    this.peers.add(req.id);
  }

  /** Set the local turn for the *current* pending tick. Latest call wins. */
  setLocalInput(turn: Turn): void {
    this.localPending = turn;
  }

  /** Buffer a remote peer's input. Out-of-window inputs are silently dropped. */
  recordRemoteInput(msg: InputMsg): void {
    if (msg.from === this.deps.localId) return;
    if (msg.tick < this.nextTick) return;
    if (msg.tick >= this.nextTick + MAX_INBOUND_BUFFER_TICKS) return;
    let turns = this.buffer.get(msg.tick);
    if (turns === undefined) {
      turns = new Map();
      this.buffer.set(msg.tick, turns);
    }
    turns.set(msg.from, msg.i);
  }

  /**
   * Advance one tick if ready. Returns null if the deadline has not yet elapsed and
   * not all expected peers' inputs are present.
   */
  advanceIfReady(now: number): AdvanceResult | null {
    if (this.nextTick > TICK_MAX) return null;
    const turns = this.buffer.get(this.nextTick) ?? new Map<PlayerId, Turn>();
    // Always include the local turn — it doesn't go through the buffer.
    turns.set(this.deps.localId, this.localPending);

    // Determine which peers we are still waiting for.
    const missing: PlayerId[] = [];
    for (const id of this.peers) {
      if (!turns.has(id)) missing.push(id);
    }

    // Wall-clock pacing: never advance faster than TICK_DURATION_MS per tick.
    // This is what makes "10 ticks per second" actually mean 10 ticks per second
    // even when peer inputs arrive faster than that.
    const minStart = this.tickDeadlineStartedAt + TICK_DURATION_MS;
    if (now < minStart) return null;

    const deadline = minStart + INPUT_TIMEOUT_MS;
    const ready = missing.length === 0 || now >= deadline;
    if (!ready) return null;

    // Default missing peers to '' (no-op turn).
    for (const id of missing) {
      turns.set(id, '');
    }

    const inputs: Inputs = {
      turns,
      joins: this.pendingJoins.slice(),
    };
    // Append exit turns for peers being removed this tick.
    for (const id of this.pendingExits) {
      turns.set(id, 'X');
    }
    this.pendingJoins.length = 0;
    this.pendingExits.clear();

    const next = simulateTick(this.state, inputs);
    this.state = next;
    this.buffer.delete(this.nextTick);
    this.nextTick++;
    this.tickDeadlineStartedAt = now;
    this.localPending = '';
    return { state: next, missing };
  }
}
