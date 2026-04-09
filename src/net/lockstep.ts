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
import {
  CONSECUTIVE_TIMEOUT_THRESHOLD,
  INPUT_TIMEOUT_MS,
  MAX_INBOUND_BUFFER_TICKS,
  TICK_DURATION_MS,
} from './constants.js';
import { isDebug } from './debug.js';
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
  /** The tick number that was just advanced. */
  readonly tick: Tick;
  /** Human-readable turn summary for debug logging (e.g. "a=L,b=_"). Only
   *  populated when debug logging is enabled; empty string otherwise. */
  readonly turnsSummary: string;
}

export class Lockstep {
  private state: GridState;
  private nextTick: Tick;
  private readonly buffer = new Map<Tick, Map<PlayerId, Turn>>();
  private readonly peers = new Set<PlayerId>();
  private readonly pendingJoins: JoinRequest[] = [];
  private readonly pendingExits = new Set<PlayerId>();
  private localPending: Turn = '';
  /** Consecutive ticks where each peer's input was missing at deadline. Reset to 0
   *  when the peer's input arrives in time. Once it exceeds CONSECUTIVE_TIMEOUT_THRESHOLD,
   *  we stop waiting for them entirely (instant default to '') so the game runs at
   *  full 10 tps for everyone else. */
  private readonly consecutiveTimeouts = new Map<PlayerId, number>();
  /** Wall-clock at which the current `nextTick` started waiting for inputs. */
  private tickDeadlineStartedAt: number;

  /** When true, advanceIfReady is a no-op. The lockstep starts paused so that the
   *  junior doesn't tick solo before receiving the senior's STATE_RESPONSE. Unpaused
   *  by: (a) installSnapshot via reset(), (b) the NetClient when it discovers it's
   *  the senior, or (c) a connection timeout (we're the seed player). */
  private paused = true;

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

  /** Replace the entire state (used by joiner sync to install a snapshot).
   *  Also unpauses the lockstep so ticking begins. */
  reset(state: GridState): void {
    this.state = state;
    this.nextTick = state.tick + 1;
    this.buffer.clear();
    this.pendingJoins.length = 0;
    this.pendingExits.clear();
    this.localPending = '';
    this.consecutiveTimeouts.clear();
    this.tickDeadlineStartedAt = this.deps.clock();
    this.paused = false;
  }

  /** Pause the lockstep (freeze recovery — wait for re-sync STATE_RESPONSE). */
  pause(): void {
    this.paused = true;
  }

  /** Unpause the lockstep (senior/seed path — not via snapshot install). */
  unpause(): void {
    if (!this.paused) return;
    this.paused = false;
    this.tickDeadlineStartedAt = this.deps.clock();
  }

  get isPaused(): boolean {
    return this.paused;
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
    this.consecutiveTimeouts.delete(id);
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

  /** Read the current local turn (for broadcasting to remote peers). */
  get localTurn(): Turn {
    return this.localPending;
  }

  /** Buffer a remote peer's input. Out-of-window inputs are silently dropped.
   *  Returns 'stale' if the input was for a tick we've already advanced past
   *  (the peer is behind us and needs a snapshot to catch up). */
  recordRemoteInput(msg: InputMsg): 'ok' | 'stale' | 'ignored' {
    if (msg.from === this.deps.localId) return 'ignored';
    if (msg.tick < this.nextTick) return 'stale';
    if (msg.tick >= this.nextTick + MAX_INBOUND_BUFFER_TICKS) return 'ignored';
    let turns = this.buffer.get(msg.tick);
    if (turns === undefined) {
      turns = new Map();
      this.buffer.set(msg.tick, turns);
    }
    turns.set(msg.from, msg.i);
    return 'ok';
  }

  /** Check if a peer has been auto-defaulted (consecutive timeouts exceeded threshold). */
  isAutoDefaulted(peerId: PlayerId): boolean {
    return (this.consecutiveTimeouts.get(peerId) ?? 0) >= CONSECUTIVE_TIMEOUT_THRESHOLD;
  }

  /**
   * Advance one tick if ready. Returns null if the deadline has not yet elapsed and
   * not all expected peers' inputs are present.
   */
  advanceIfReady(now: number): AdvanceResult | null {
    if (this.paused) return null;
    if (this.nextTick > TICK_MAX) return null;
    const turns = this.buffer.get(this.nextTick) ?? new Map<PlayerId, Turn>();
    // Always include the local turn — it doesn't go through the buffer.
    turns.set(this.deps.localId, this.localPending);

    // Determine which peers we are still waiting for. Peers who have exceeded the
    // consecutive timeout threshold are "auto-defaulted" — we don't wait for them
    // at all, just default to '' immediately. This keeps the game at 10 tps for
    // everyone else while the frozen peer's cycle drifts straight on autopilot.
    const missing: PlayerId[] = [];
    const autoDefaulted: PlayerId[] = [];
    for (const id of this.peers) {
      if (turns.has(id)) continue;
      const consecutive = this.consecutiveTimeouts.get(id) ?? 0;
      if (consecutive >= CONSECUTIVE_TIMEOUT_THRESHOLD) {
        autoDefaulted.push(id);
      } else {
        missing.push(id);
      }
    }
    // Auto-default frozen peers immediately (no wait).
    for (const id of autoDefaulted) {
      turns.set(id, '');
    }

    // Wall-clock pacing: never advance faster than TICK_DURATION_MS per tick.
    const minStart = this.tickDeadlineStartedAt + TICK_DURATION_MS;
    if (now < minStart) return null;

    const deadline = minStart + INPUT_TIMEOUT_MS;
    const ready = missing.length === 0 || now >= deadline;
    if (!ready) return null;

    // Default the remaining missing peers to '' (they haven't hit the threshold yet).
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

    // Update per-peer consecutive-timeout counters.
    const timedOut = new Set<PlayerId>();
    for (const id of missing) timedOut.add(id);
    for (const id of autoDefaulted) timedOut.add(id);
    for (const id of timedOut) {
      this.consecutiveTimeouts.set(id, (this.consecutiveTimeouts.get(id) ?? 0) + 1);
    }
    // Reset counters for peers who DID send their input in time.
    for (const id of this.peers) {
      if (!timedOut.has(id) && id !== this.deps.localId) {
        this.consecutiveTimeouts.set(id, 0);
      }
    }

    const next = simulateTick(this.state, inputs);
    let turnsSummary = '';
    if (isDebug()) {
      const turnsStr = [...turns.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([id, t]) => `${id}=${t || '_'}`)
        .join(',');
      const joinsStr =
        inputs.joins.length === 0 ? '' : ` joins=[${inputs.joins.map((j) => j.id).join(',')}]`;
      turnsSummary = `turns={${turnsStr}}${joinsStr}`;
    }
    const advancedTick = this.nextTick;
    this.state = next;
    this.buffer.delete(this.nextTick);
    this.nextTick++;
    this.tickDeadlineStartedAt = now;
    this.localPending = '';
    return { state: next, missing, tick: advancedTick, turnsSummary };
  }
}
