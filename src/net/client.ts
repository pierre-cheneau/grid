// NetClient — the public facade that wires room + lockstep + hashCheck + evict +
// peer-registry + sync into a single object. Drives the lockstep loop in pull
// mode via `runOnce(now)`; the CLI wraps that in a setInterval.

import { type Config, type GridState, type PlayerId, type Turn, hashState } from '../sim/index.js';
import { FREEZE_THRESHOLD_MS, MAX_PROTOCOL_FAULTS, SEED_TIMEOUT_MS } from './constants.js';
import { dbg } from './debug.js';
import { EvictionTracker } from './evict.js';
import { HashCheck } from './hashCheck.js';
import { Lockstep } from './lockstep.js';
import type {
  EvictMsg,
  EvictReason,
  InputMsg,
  Message,
  StateHashMsg,
  StateRequestMsg,
  StateResponseMsg,
} from './messages.js';
import { ProtocolError } from './messages.js';
import { PeerRegistry } from './peer-registry.js';
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

type TickListener = (state: GridState) => void;
type PeerListener = (peerId: string) => void;
type EvictListener = (peerId: string, reason: EvictReason) => void;

export class NetClient {
  private readonly localId: string;
  private readonly lockstep: Lockstep;
  private readonly hashCheck = new HashCheck();
  private readonly evictTracker = new EvictionTracker();
  private readonly registry: PeerRegistry;
  private readonly faultCounts = new Map<string, number>();
  private readonly pendingStateResponses = new Set<string>();
  private room: Room | null = null;
  private stopped = false;
  private seedTimer: ReturnType<typeof setTimeout> | null = null;
  private lastRunOnceAt = 0;
  private cachedHash = '';

  private readonly tickListeners: TickListener[] = [];
  private readonly joinListeners: PeerListener[] = [];
  private readonly leaveListeners: PeerListener[] = [];
  private readonly evictListeners: EvictListener[] = [];

  constructor(
    private readonly cfg: NetClientConfig,
    private readonly deps: NetClientDeps,
  ) {
    this.localId = cfg.identity.id;
    this.registry = new PeerRegistry(this.localId, cfg.identity.joinedAt);
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

  get isPaused(): boolean {
    return this.lockstep.isPaused;
  }

  get stateHash(): string {
    return this.cachedHash;
  }

  get peers(): ReadonlySet<PlayerId> {
    return this.lockstep.expectedPeers;
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
    this.room.onCtrl((raw, sid) => this.onMessage(raw, sid));
    this.room.onTick((raw, sid) => this.onMessage(raw, sid));
    this.room.onPeerLeave((sid) => this.onTransportLeave(sid));
    this.room.onPeerJoin(() => this.broadcastHello());
    this.broadcastHello();
    dbg(`client[${this.localId}]: HELLO broadcast`);
    this.seedTimer = setTimeout(() => {
      if (this.lockstep.isPaused) {
        dbg(`client[${this.localId}]: seed timeout — no peers, unpausing`);
        this.lockstep.unpause();
      }
    }, SEED_TIMEOUT_MS);
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    if (this.seedTimer !== null) clearTimeout(this.seedTimer);
    if (this.room) {
      this.room.sendCtrl(encodeMessage({ v: 1, t: 'BYE', from: this.localId }));
      await this.room.leave();
    }
  }

  setLocalInput(turn: Turn): void {
    this.lockstep.setLocalInput(turn);
    this.broadcastLocalInput();
  }

  runOnce(now: number): GridState | null {
    if (this.stopped || this.room === null) return null;
    // Freeze detection.
    if (this.lastRunOnceAt > 0 && now - this.lastRunOnceAt > FREEZE_THRESHOLD_MS) {
      if (!this.lockstep.isPaused && this.registry.size > 0) {
        dbg(`client[${this.localId}]: freeze detected (gap=${now - this.lastRunOnceAt}ms)`);
        this.lockstep.pause();
        const senior = this.pickSeniorPeer();
        if (senior !== null) this.sendStateRequest(senior);
      }
    }
    this.lastRunOnceAt = now;
    this.broadcastLocalInput();
    const result = this.lockstep.advanceIfReady(now);
    if (result === null) return null;
    const newState = result.state;
    this.cachedHash = hashState(newState);
    if (result.turnsSummary) {
      dbg(
        `lockstep[${this.localId}]: advance tick=${result.tick} ${result.turnsSummary} → hash=${this.cachedHash}`,
      );
    }
    this.drainPendingStateResponses();
    for (const cb of this.tickListeners) cb(newState);
    if (HashCheck.isCadenceTick(newState.tick)) {
      this.room.sendTick(
        encodeMessage({
          v: 1,
          t: 'STATE_HASH',
          from: this.localId,
          tick: newState.tick,
          h: this.cachedHash,
        }),
      );
      this.hashCheck.recordOwn(newState.tick, this.cachedHash, this.localId);
    }
    return newState;
  }

  // ---- Internal: message routing ----

  private onMessage(raw: string, sessionId: string): void {
    let msg: Message;
    try {
      msg = parseMessage(raw);
    } catch (e) {
      if (e instanceof ProtocolError) {
        this.recordFault(sessionId, e.message);
        return;
      }
      throw e;
    }
    if (msg.t === 'HELLO') {
      this.handleHello(msg, sessionId);
      return;
    }
    const expected = this.registry.playerFor(sessionId);
    if (expected === undefined) {
      this.recordFault(sessionId, `${msg.t} from unknown session`);
      return;
    }
    if (msg.from !== expected) {
      this.recordFault(sessionId, `from "${msg.from}" ≠ registered "${expected}"`);
      return;
    }
    this.faultCounts.set(sessionId, 0);
    this.dispatch(msg);
  }

  private dispatch(msg: Message): void {
    dbg(`client[${this.localId}]: dispatch ${msg.t} from ${msg.from}`);
    switch (msg.t) {
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
        void this.stop();
        break;
      case 'BYE':
        this.onTransportLeave(msg.from);
        break;
    }
  }

  // ---- Internal: handlers ----

  private handleHello(msg: import('./messages.js').HelloMsg, sessionId: string): void {
    const result = this.registry.registerHello(msg, sessionId);
    this.faultCounts.set(sessionId, 0);
    if (result.kind === 'spoof') {
      this.recordFault(sessionId, result.reason);
      return;
    }
    if (result.kind === 'known') return;
    this.lockstep.addPeer(msg.from);
    this.broadcastHello();
    if (result.isSenior) {
      dbg(`client[${this.localId}]: ${msg.from} is senior; sending STATE_REQUEST`);
      this.sendStateRequest(msg.from);
    } else {
      dbg(`client[${this.localId}]: ${msg.from} is junior; queueing join + response`);
      this.lockstep.unpause();
      if (this.seedTimer !== null) {
        clearTimeout(this.seedTimer);
        this.seedTimer = null;
      }
      this.lockstep.queueJoin({ id: msg.from, colorSeed: msg.color_seed });
      this.pendingStateResponses.add(msg.from);
    }
    for (const cb of this.joinListeners) cb(msg.from);
  }

  private handleInput(msg: InputMsg): void {
    const result = this.lockstep.recordRemoteInput(msg);
    if (result === 'stale' && this.lockstep.isAutoDefaulted(msg.from)) {
      if (!this.pendingStateResponses.has(msg.from)) {
        dbg(`client[${this.localId}]: stale INPUT from ${msg.from}; queueing STATE_RESPONSE`);
        this.pendingStateResponses.add(msg.from);
      }
    }
  }

  private handleStateHash(msg: StateHashMsg): void {
    this.hashCheck.recordRemote(msg);
    const desync = this.hashCheck.classify(msg.tick);
    if (desync === null) return;
    if (desync.minority.includes(this.localId)) {
      dbg(`client[${this.localId}]: desync at tick ${msg.tick} — re-syncing`);
      this.lockstep.pause();
      this.sendStateRequest(msg.from);
    } else {
      for (const target of desync.minority) this.castEvict(target, 'hash_mismatch', msg.tick);
    }
  }

  private handleEvict(msg: EvictMsg): void {
    const decision = this.evictTracker.record(msg, this.registry.size + 1);
    if (decision === null) return;
    if (decision.target === this.localId) {
      void this.stop();
      return;
    }
    this.registry.removeByPlayer(decision.target);
    this.lockstep.removePeer(decision.target);
    for (const cb of this.evictListeners) cb(decision.target, decision.reason);
  }

  private handleStateRequest(msg: StateRequestMsg): void {
    if (!this.registry.peers.has(msg.from)) return;
    this.pendingStateResponses.add(msg.from);
    dbg(`client[${this.localId}]: queued STATE_RESPONSE for ${msg.from}`);
  }

  private handleStateResponse(msg: StateResponseMsg): void {
    if (msg.to !== this.localId) return;
    const { state } = installSnapshot(msg);
    dbg(`client[${this.localId}]: installing snapshot from ${msg.from} at tick ${state.tick}`);
    this.lockstep.reset(state);
    for (const pid of state.players.keys()) {
      if (pid !== this.localId) this.lockstep.addPeer(pid);
    }
  }

  // ---- Internal: helpers ----

  private broadcastLocalInput(): void {
    if (this.room === null || this.stopped) return;
    const tick = this.lockstep.currentTick + 1;
    this.room.sendTick(
      encodeMessage({ v: 1, t: 'INPUT', from: this.localId, tick, i: this.lockstep.localTurn }),
    );
  }

  private broadcastHello(): void {
    if (this.room === null) return;
    const id = this.cfg.identity;
    this.room.sendCtrl(
      encodeMessage({
        v: 1,
        t: 'HELLO',
        from: this.localId,
        color: [id.colorSeed & 0xff, (id.colorSeed >> 8) & 0xff, (id.colorSeed >> 16) & 0xff],
        color_seed: id.colorSeed,
        kind: 'pilot',
        client: 'grid/0.1.0',
        joined_at: id.joinedAt,
      }),
    );
  }

  private sendStateRequest(toPlayerId: string): void {
    if (this.room === null) return;
    const sid = this.registry.sessionFor(toPlayerId);
    if (sid === undefined) return;
    this.room.sendCtrl(encodeMessage({ v: 1, t: 'STATE_REQUEST', from: this.localId }), sid);
  }

  private drainPendingStateResponses(): void {
    if (this.room === null || this.pendingStateResponses.size === 0) return;
    for (const pid of [...this.pendingStateResponses]) {
      const sid = this.registry.sessionFor(pid);
      if (sid === undefined) continue;
      const resp = buildStateResponse(this.localId, pid, this.lockstep.currentState);
      this.room.sendCtrl(encodeMessage(resp), sid);
      dbg(
        `client[${this.localId}]: sent STATE_RESPONSE to ${pid} at tick ${this.lockstep.currentTick}`,
      );
    }
    this.pendingStateResponses.clear();
  }

  private onTransportLeave(sessionId: string): void {
    const pid = this.registry.removeBySession(sessionId);
    if (pid !== undefined) {
      this.lockstep.removePeer(pid);
      this.evictTracker.forget(pid);
      this.pendingStateResponses.delete(pid);
      for (const cb of this.leaveListeners) cb(pid);
    }
  }

  private recordFault(sessionId: string, reason: string): void {
    const n = (this.faultCounts.get(sessionId) ?? 0) + 1;
    this.faultCounts.set(sessionId, n);
    dbg(`client[${this.localId}]: fault from ${sessionId} (${n}): ${reason}`);
    if (n === MAX_PROTOCOL_FAULTS) {
      const pid = this.registry.playerFor(sessionId);
      if (pid !== undefined) this.castEvict(pid, 'disconnect', this.lockstep.currentTick);
    }
  }

  private castEvict(target: string, reason: EvictReason, tick: number): void {
    if (this.room === null) return;
    const msg: EvictMsg = { v: 1, t: 'EVICT', from: this.localId, target, reason, tick };
    this.room.sendCtrl(encodeMessage(msg));
    this.handleEvict(msg);
  }

  private pickSeniorPeer(): string | null {
    const candidates = [...this.registry.peers.values()].map((p) => ({
      id: p.id,
      joinedAt: p.joinedAt,
    }));
    if (candidates.length === 0) return null;
    const winner = pickResponder(candidates, this.localId, this.cfg.identity.joinedAt);
    return winner === this.localId ? (candidates[0]?.id ?? null) : winner;
  }
}
