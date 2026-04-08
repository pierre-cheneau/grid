// NetClient — the public facade that wires room + lockstep + hashCheck + evict + sync
// into a single object. Drives the lockstep loop in pull mode via `runOnce(now)`; the
// CLI wraps that in a setInterval, tests drive it manually.
//
// All untrusted parsing happens in `protocol.ts`; this file trusts the parsed Message
// type and acts on it.

import { type Config, type GridState, type PlayerId, type Turn, hashState } from '../sim/index.js';
import { MAX_PROTOCOL_FAULTS } from './constants.js';
import { dbg } from './debug.js';
import { EvictionTracker } from './evict.js';
import { HashCheck } from './hashCheck.js';
import { Lockstep } from './lockstep.js';
import {
  type ByeMsg,
  type EvictMsg,
  type EvictReason,
  type HelloMsg,
  type InputMsg,
  type Message,
  ProtocolError,
  type StateHashMsg,
  type StateRequestMsg,
  type StateResponseMsg,
} from './messages.js';
import { encodeMessage, parseMessage } from './protocol.js';
import type { Room, RoomFactory } from './room.js';
import { buildStateResponse, installSnapshot } from './sync.js';

export interface NetIdentity {
  readonly id: string;
  readonly colorSeed: number;
  readonly joinedAt: number;
}

export interface NetClientConfig {
  readonly roomKey: string;
  readonly identity: NetIdentity;
  readonly initialState: GridState;
}

export interface NetClientDeps {
  readonly roomFactory: RoomFactory;
  readonly clock: () => number;
}

type Listener<T> = (arg: T) => void;
type TickListener = Listener<GridState>;
type PeerListener = Listener<string>;
type EvictListener = (peerId: string, reason: EvictReason) => void;

interface PeerInfo {
  readonly id: string;
  readonly joinedAt: number;
  readonly color: readonly [number, number, number];
}

export class NetClient {
  private readonly localId: string;
  private readonly lockstep: Lockstep;
  private readonly hashCheck = new HashCheck();
  private readonly evictTracker = new EvictionTracker();
  private readonly knownPeers = new Map<string, PeerInfo>();
  private readonly faultCounts = new Map<string, number>();
  /** sessionId (transport) → playerId (wire-protocol). Populated by HELLO. */
  private readonly sessionToPlayer = new Map<string, string>();
  /** playerId → sessionId. Inverse of sessionToPlayer; needed for targeted sends. */
  private readonly playerToSession = new Map<string, string>();
  /** Player ids we owe a STATE_RESPONSE to, drained after the next tick advance. */
  private readonly pendingStateResponses = new Set<string>();
  private room: Room | null = null;
  private lastBroadcastTick = -1;
  private stopped = false;

  private readonly tickListeners: TickListener[] = [];
  private readonly joinListeners: PeerListener[] = [];
  private readonly leaveListeners: PeerListener[] = [];
  private readonly evictListeners: EvictListener[] = [];

  constructor(
    private readonly cfg: NetClientConfig,
    private readonly deps: NetClientDeps,
  ) {
    this.localId = cfg.identity.id;
    this.lockstep = new Lockstep({
      localId: this.localId,
      initialState: cfg.initialState,
      clock: deps.clock,
    });
  }

  get currentState(): GridState {
    return this.lockstep.currentState;
  }

  get config(): Config {
    return this.cfg.initialState.config;
  }

  on(event: 'tick', cb: TickListener): void;
  on(event: 'peerJoin', cb: PeerListener): void;
  on(event: 'peerLeave', cb: PeerListener): void;
  on(event: 'evict', cb: EvictListener): void;
  on(event: string, cb: TickListener | PeerListener | EvictListener): void {
    if (event === 'tick') this.tickListeners.push(cb as TickListener);
    else if (event === 'peerJoin') this.joinListeners.push(cb as PeerListener);
    else if (event === 'peerLeave') this.leaveListeners.push(cb as PeerListener);
    else if (event === 'evict') this.evictListeners.push(cb as EvictListener);
  }

  async start(): Promise<void> {
    dbg(`client[${this.localId}]: start`);
    this.room = await this.deps.roomFactory(this.cfg.roomKey, this.localId);
    // Order matters: register the data-channel listeners FIRST. Some Room
    // implementations replay existing peers synchronously when `onPeerJoin` is
    // registered, which triggers our broadcastHello, which may trigger an immediate
    // response from the remote via their self-heal — and that response arrives on
    // ctrl. If onCtrl/onTick aren't registered yet, the response is lost.
    this.room.onCtrl((raw, peerId) => this.onMessage(raw, peerId));
    this.room.onTick((raw, peerId) => this.onMessage(raw, peerId));
    this.room.onPeerLeave((peerId) => this.onPeerLeave(peerId));
    this.room.onPeerJoin((peerId) => this.onPeerJoin(peerId));
    // Announce ourselves to any peers that were already present at createRoom time
    // but missed the onPeerJoin replay above (because they had no listeners back
    // then). The remote's self-heal will catch us if our HELLO is itself lost.
    this.broadcastHello();
    dbg(`client[${this.localId}]: HELLO broadcast`);
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    if (this.room) {
      const bye: ByeMsg = { v: 1, t: 'BYE', from: this.localId };
      this.room.sendCtrl(encodeMessage(bye));
      await this.room.leave();
    }
  }

  setLocalInput(turn: Turn): void {
    this.localTurn = turn;
    this.lockstep.setLocalInput(turn);
  }

  /** Drive the simulation forward if the lockstep is ready. Idempotent if not. */
  runOnce(now: number): GridState | null {
    if (this.stopped || this.room === null) return null;

    // (1) Broadcast our INPUT for the current pending tick once.
    const pendingTick = this.lockstep.currentTick + 1;
    if (this.lastBroadcastTick < pendingTick) {
      const turn = this.peekLocalInput();
      const msg: InputMsg = {
        v: 1,
        t: 'INPUT',
        from: this.localId,
        tick: pendingTick,
        i: turn,
      };
      this.room.sendTick(encodeMessage(msg));
      this.lastBroadcastTick = pendingTick;
    }

    // (2) Try to advance.
    const result = this.lockstep.advanceIfReady(now);
    if (result === null) return null;
    const newState = result.state;
    // One-shot input semantics: turning is a discrete event. Reset for the next tick.
    this.localTurn = '';
    // Drain any STATE_RESPONSEs we owe juniors. This must happen AFTER the tick
    // advance so the response carries the post-join state.
    this.drainPendingStateResponses();
    for (const cb of this.tickListeners) cb(newState);

    // (3) Hash cadence.
    if (HashCheck.isCadenceTick(newState.tick)) {
      const h = hashState(newState);
      const stateHash: StateHashMsg = {
        v: 1,
        t: 'STATE_HASH',
        from: this.localId,
        tick: newState.tick,
        h,
      };
      this.room.sendTick(encodeMessage(stateHash));
      this.hashCheck.recordOwn(newState.tick, h, this.localId);
      const desync = this.hashCheck.classify(newState.tick);
      if (desync && !desync.minority.includes(this.localId)) {
        for (const target of desync.minority) {
          this.castEvict(target, 'hash_mismatch', newState.tick);
        }
      }
    }
    return newState;
  }

  // ---- Internal ----

  private peekLocalInput(): Turn {
    // The lockstep stores the local pending turn privately; we read it indirectly by
    // letting the lockstep handle defaulting. The wire INPUT carries whatever the
    // lockstep will eventually use, which is the turn the user last set.
    // Simpler approach: keep our own copy.
    return this.localTurn;
  }

  private localTurn: Turn = '';

  private broadcastHello(): void {
    if (this.room === null) return;
    const id = this.cfg.identity;
    const hello: HelloMsg = {
      v: 1,
      t: 'HELLO',
      from: this.localId,
      color: this.colorFromSeed(id.colorSeed),
      color_seed: id.colorSeed,
      kind: 'pilot',
      client: 'grid/0.1.0',
      joined_at: id.joinedAt,
    };
    this.room.sendCtrl(encodeMessage(hello));
  }

  private colorFromSeed(seed: number): [number, number, number] {
    return [seed & 0xff, (seed >> 8) & 0xff, (seed >> 16) & 0xff];
  }

  private sendStateRequest(toPlayerId: string): void {
    if (this.room === null) return;
    const sessionId = this.playerToSession.get(toPlayerId);
    if (sessionId === undefined) {
      dbg(`client[${this.localId}]: cannot STATE_REQUEST ${toPlayerId} — no session id`);
      return;
    }
    const msg: StateRequestMsg = { v: 1, t: 'STATE_REQUEST', from: this.localId };
    this.room.sendCtrl(encodeMessage(msg), sessionId);
  }

  private drainPendingStateResponses(): void {
    if (this.room === null || this.pendingStateResponses.size === 0) return;
    const ids = [...this.pendingStateResponses];
    this.pendingStateResponses.clear();
    for (const playerId of ids) {
      const sessionId = this.playerToSession.get(playerId);
      if (sessionId === undefined) {
        dbg(`client[${this.localId}]: cannot send STATE_RESPONSE to ${playerId} — no session`);
        continue;
      }
      const resp = buildStateResponse(this.localId, playerId, this.lockstep.currentState);
      this.room.sendCtrl(encodeMessage(resp), sessionId);
      dbg(
        `client[${this.localId}]: sent STATE_RESPONSE to ${playerId} at tick ${this.lockstep.currentTick}`,
      );
    }
  }

  private onPeerJoin(sessionId: string): void {
    dbg(`client[${this.localId}]: transport peer joined session=${sessionId}`);
    // The transport just told us a new peer is reachable. Re-broadcast our HELLO so
    // they learn our player id, color, and seniority. (Our initial HELLO at start()
    // may have been sent before this peer was connected and lost.)
    this.broadcastHello();
  }

  private onPeerLeave(sessionId: string): void {
    dbg(`client[${this.localId}]: transport peer left session=${sessionId}`);
    const playerId = this.sessionToPlayer.get(sessionId);
    this.sessionToPlayer.delete(sessionId);
    if (playerId !== undefined) {
      this.playerToSession.delete(playerId);
      this.knownPeers.delete(playerId);
      this.lockstep.removePeer(playerId);
      this.evictTracker.forget(playerId);
      this.pendingStateResponses.delete(playerId);
      for (const cb of this.leaveListeners) cb(playerId);
    }
  }

  private onMessage(raw: string, sessionId: string): void {
    let msg: Message;
    try {
      msg = parseMessage(raw);
    } catch (e) {
      if (e instanceof ProtocolError) {
        this.recordFault(sessionId, `parse: ${e.message}`);
        return;
      }
      throw e;
    }
    // Resolve sender → playerId. HELLO is the only message that can establish a
    // new mapping; everything else must come from a session whose HELLO we already
    // saw, AND its `from` must match the registered player id.
    if (msg.t === 'HELLO') {
      this.faultCounts.set(sessionId, 0);
      this.handleHelloFromSession(msg, sessionId);
      return;
    }
    const expectedPlayerId = this.sessionToPlayer.get(sessionId);
    if (expectedPlayerId === undefined) {
      this.recordFault(sessionId, `${msg.t} from unknown session (no HELLO yet)`);
      return;
    }
    if (msg.from !== expectedPlayerId) {
      this.recordFault(
        sessionId,
        `${msg.t} from "${msg.from}" but session is registered as "${expectedPlayerId}"`,
      );
      return;
    }
    this.faultCounts.set(sessionId, 0);
    this.dispatch(msg);
  }

  private recordFault(sessionId: string, reason: string): void {
    const n = (this.faultCounts.get(sessionId) ?? 0) + 1;
    this.faultCounts.set(sessionId, n);
    dbg(`client[${this.localId}]: protocol fault from ${sessionId} (${n}): ${reason}`);
    if (n === MAX_PROTOCOL_FAULTS) {
      // Cast exactly once at the threshold. Further faults from the same session
      // are silently ignored to prevent eviction storms.
      const playerId = this.sessionToPlayer.get(sessionId);
      if (playerId !== undefined) {
        this.castEvict(playerId, 'disconnect', this.lockstep.currentTick);
      }
    }
  }

  private dispatch(msg: Message): void {
    dbg(`client[${this.localId}]: dispatch ${msg.t} from ${msg.from}`);
    switch (msg.t) {
      case 'HELLO':
        // HELLO is handled in onMessage before dispatch (it establishes the session
        // mapping). Reaching here means a duplicate HELLO from a known session — no-op.
        break;
      case 'INPUT':
        this.handleInput(msg);
        break;
      case 'STATE_HASH':
        this.handleStateHash(msg);
        break;
      case 'EVICT':
        this.handleEvict(msg);
        break;
      case 'STATE_REQUEST':
        this.handleStateRequest(msg);
        break;
      case 'STATE_RESPONSE':
        this.handleStateResponse(msg);
        break;
      case 'KICKED':
        // Server told us we're kicked. Drop out cleanly.
        void this.stop();
        break;
      case 'BYE':
        this.onPeerLeave(msg.from);
        break;
    }
  }

  private handleHelloFromSession(msg: HelloMsg, sessionId: string): void {
    // (1) Register the bidirectional sessionId↔playerId mapping. This is the only
    // place where the mapping is created. Subsequent messages from this sessionId
    // are validated against the registered playerId.
    const existingPlayer = this.sessionToPlayer.get(sessionId);
    if (existingPlayer !== undefined && existingPlayer !== msg.from) {
      // The session is trying to switch player ids — that's a spoof attempt.
      this.recordFault(sessionId, `HELLO claims "${msg.from}" but session was "${existingPlayer}"`);
      return;
    }
    if (this.knownPeers.has(msg.from)) {
      // We already know this peer. Idempotent re-broadcast on Trystero onPeerJoin.
      dbg(`client[${this.localId}]: HELLO from ${msg.from} (already known)`);
      // Ensure the session mapping is fresh in case the same playerId reconnected.
      this.sessionToPlayer.set(sessionId, msg.from);
      this.playerToSession.set(msg.from, sessionId);
      return;
    }
    dbg(
      `client[${this.localId}]: HELLO from ${msg.from} session=${sessionId} joinedAt=${msg.joined_at}`,
    );
    this.sessionToPlayer.set(sessionId, msg.from);
    this.playerToSession.set(msg.from, sessionId);
    this.knownPeers.set(msg.from, {
      id: msg.from,
      joinedAt: msg.joined_at,
      color: msg.color,
    });
    // Always add the new peer to the lockstep's expected-input set. The remote
    // peer is now part of the simulation contract regardless of seniority — the
    // lockstep must wait for their INPUT each tick instead of defaulting to ''.
    this.lockstep.addPeer(msg.from);
    // Self-heal: re-broadcast our HELLO so the new peer learns us regardless of any
    // listener-registration race that may have dropped our initial broadcast. The
    // remote side ignores duplicates because handleHelloFromSession returns early
    // when the player is already known.
    this.broadcastHello();
    // (2) Decide who is senior. The senior owns the canonical state; the junior
    // installs a snapshot from the senior on join.
    const remoteIsSenior =
      msg.joined_at < this.cfg.identity.joinedAt ||
      (msg.joined_at === this.cfg.identity.joinedAt && msg.from < this.localId);
    if (remoteIsSenior) {
      // We are the junior. Ask the senior for their current state. (We do NOT
      // queue a JoinRequest — the senior's state will replace ours entirely on
      // STATE_RESPONSE install.)
      dbg(`client[${this.localId}]: ${msg.from} is senior; sending STATE_REQUEST`);
      this.sendStateRequest(msg.from);
    } else {
      // We are the senior. Queue a JoinRequest so the junior enters our simulation
      // on the next tick advance, and remember to send them a STATE_RESPONSE
      // immediately afterward (so the response carries the post-join state).
      dbg(
        `client[${this.localId}]: ${msg.from} is junior; queueing JoinRequest + pending response`,
      );
      this.lockstep.queueJoin({ id: msg.from, colorSeed: msg.color_seed });
      this.pendingStateResponses.add(msg.from);
    }
    for (const cb of this.joinListeners) cb(msg.from);
  }

  private handleInput(msg: InputMsg): void {
    this.lockstep.recordRemoteInput(msg);
  }

  private handleStateHash(msg: StateHashMsg): void {
    this.hashCheck.recordRemote(msg);
  }

  private handleEvict(msg: EvictMsg): void {
    const totalPeerCount = this.knownPeers.size + 1; // +1 for self
    const decision = this.evictTracker.record(msg, totalPeerCount);
    if (decision === null) return;
    if (decision.target === this.localId) {
      void this.stop();
      return;
    }
    this.knownPeers.delete(decision.target);
    this.lockstep.removePeer(decision.target);
    for (const cb of this.evictListeners) cb(decision.target, decision.reason);
  }

  private handleStateRequest(msg: StateRequestMsg): void {
    // The junior is asking us for our state. Queue a deferred response so it carries
    // the post-tick state (by which time the JoinRequest queued in handleHelloFromSession
    // has been processed and the junior is in our state.players).
    if (!this.knownPeers.has(msg.from)) {
      dbg(`client[${this.localId}]: STATE_REQUEST from unknown ${msg.from} (ignored)`);
      return;
    }
    this.pendingStateResponses.add(msg.from);
    dbg(`client[${this.localId}]: queued STATE_RESPONSE for ${msg.from}`);
  }

  private handleStateResponse(msg: StateResponseMsg): void {
    if (msg.to !== this.localId) return;
    const { state } = installSnapshot(msg);
    // Reset the lockstep with the installed state. The senior's state already
    // contains us as a player (because they processed our JoinRequest before sending).
    dbg(`client[${this.localId}]: installing snapshot from ${msg.from} at tick ${state.tick}`);
    this.lockstep.reset(state);
    // Repopulate the lockstep's expected-peer set from the snapshot's player map,
    // since reset() clears it and the seniors are now canonical.
    for (const playerId of state.players.keys()) {
      if (playerId !== this.localId) this.lockstep.addPeer(playerId);
    }
    this.lastBroadcastTick = -1;
  }

  private castEvict(target: string, reason: EvictReason, tick: number): void {
    if (this.room === null) return;
    const msg: EvictMsg = { v: 1, t: 'EVICT', from: this.localId, target, reason, tick };
    this.room.sendCtrl(encodeMessage(msg));
    // Also count our own vote toward the local tally.
    this.handleEvict(msg);
  }

  /** Players we expect inputs from this tick. */
  get peers(): ReadonlySet<PlayerId> {
    return this.lockstep.expectedPeers;
  }
}
