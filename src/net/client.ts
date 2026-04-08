// NetClient — the public facade that wires room + lockstep + hashCheck + evict + sync
// into a single object. Drives the lockstep loop in pull mode via `runOnce(now)`; the
// CLI wraps that in a setInterval, tests drive it manually.
//
// All untrusted parsing happens in `protocol.ts`; this file trusts the parsed Message
// type and acts on it.

import { type Config, type GridState, type PlayerId, type Turn, hashState } from '../sim/index.js';
import { MAX_PROTOCOL_FAULTS } from './constants.js';
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
import { buildStateResponse, installSnapshot, pickResponder } from './sync.js';

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
    this.room = await this.deps.roomFactory(this.cfg.roomKey, this.localId);
    this.room.onPeerJoin((peerId) => this.onPeerJoin(peerId));
    this.room.onPeerLeave((peerId) => this.onPeerLeave(peerId));
    this.room.onCtrl((raw, peerId) => this.onMessage(raw, peerId));
    this.room.onTick((raw, peerId) => this.onMessage(raw, peerId));
    // Announce ourselves.
    this.broadcastHello();
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
      kind: 'pilot',
      client: 'grid/0.1.0',
      joined_at: id.joinedAt,
    };
    this.room.sendCtrl(encodeMessage(hello));
  }

  private colorFromSeed(seed: number): [number, number, number] {
    return [seed & 0xff, (seed >> 8) & 0xff, (seed >> 16) & 0xff];
  }

  private onPeerJoin(peerId: string): void {
    // Trystero peer ids are opaque; we wait for HELLO to learn the wire-protocol id.
    // Until then, we just count them.
    void peerId;
  }

  private onPeerLeave(peerId: string): void {
    this.knownPeers.delete(peerId);
    this.lockstep.removePeer(peerId);
    this.evictTracker.forget(peerId);
    for (const cb of this.leaveListeners) cb(peerId);
  }

  private onMessage(raw: string, sender: string): void {
    let msg: Message;
    try {
      msg = parseMessage(raw, sender);
    } catch (e) {
      if (e instanceof ProtocolError) {
        const n = (this.faultCounts.get(sender) ?? 0) + 1;
        this.faultCounts.set(sender, n);
        if (n === MAX_PROTOCOL_FAULTS) {
          // Cast exactly once at the threshold; further faults from the same peer
          // are silently ignored to prevent eviction storms.
          this.castEvict(sender, 'disconnect', this.lockstep.currentTick);
        }
        return;
      }
      throw e;
    }
    this.faultCounts.set(sender, 0);
    this.dispatch(msg);
  }

  private dispatch(msg: Message): void {
    switch (msg.t) {
      case 'HELLO':
        this.handleHello(msg);
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

  private handleHello(msg: HelloMsg): void {
    if (this.knownPeers.has(msg.from)) return;
    this.knownPeers.set(msg.from, {
      id: msg.from,
      joinedAt: msg.joined_at,
      color: msg.color,
    });
    this.lockstep.addPeer(msg.from);
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
    if (this.room === null) return;
    // Determine the senior responder. Tie-breaker on (joinedAt, id).
    const candidates = [...this.knownPeers.values()].map((p) => ({
      id: p.id,
      joinedAt: p.joinedAt,
    }));
    const responder = pickResponder(candidates, this.localId, this.cfg.identity.joinedAt);
    if (responder !== this.localId) return;
    const resp = buildStateResponse(this.localId, msg.from, this.lockstep.currentState);
    this.room.sendCtrl(encodeMessage(resp), msg.from);
  }

  private handleStateResponse(msg: StateResponseMsg): void {
    if (msg.to !== this.localId) return;
    const { state } = installSnapshot(msg);
    // Reset the lockstep with the installed state.
    this.lockstep.reset(state);
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
