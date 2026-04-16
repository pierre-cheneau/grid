// TileMesh — per-tile networking bundle.
//
// Encapsulates everything the original NetClient treated as per-tile:
// Room (WebRTC mesh + Nostr presence/signaling), Lockstep (simulation),
// PeerRegistry, HashCheck, EvictionTracker, per-tile fault counts,
// pending STATE_RESPONSE queue, seed timer, and chain hash.
//
// Emits domain events (peer join/leave, tick advance, eviction, kicked)
// via injected callbacks so a multi-mesh orchestrator (NetClient) can
// aggregate them across meshes.
//
// Stage 14b introduces TileMesh as a pure structural refactor: NetClient
// now holds exactly ONE TileMesh (the player's home tile) and delegates.
// Behavior, wire protocol, and the determinism hash are unchanged from
// v0.2. Stage 17b will hold multiple TileMeshes simultaneously (shadow
// zones) using the same class.

import { GENESIS_HASH, computeChainHash } from '../persist/chain.js';
import { type GridState, type PlayerId, type Tick, type Turn, hashState } from '../sim/index.js';
import type { NetIdentity } from './client.js';
import { FREEZE_THRESHOLD_MS, MAX_PROTOCOL_FAULTS, SEED_TIMEOUT_MS } from './constants.js';
import { dbg } from './debug.js';
import { EvictionTracker } from './evict.js';
import { HashCheck } from './hashCheck.js';
import { Lockstep } from './lockstep.js';
import type {
  EvictMsg,
  EvictReason,
  HelloMsg,
  InputMsg,
  Message,
  StateHashMsg,
  StateRequestMsg,
  StateResponseMsg,
} from './messages.js';
import { ProtocolError } from './messages.js';
import { PeerRegistry } from './peer-registry.js';
import { encodeMessage, parseMessage } from './protocol.js';
import type { Room } from './room.js';
import { buildStateResponse, installSnapshot, pickResponder } from './sync.js';
import type { TileId } from './tile-id.js';

/** Callbacks bubbled up from TileMesh to its owner (NetClient). Global
 *  concerns like listener arrays and daemon bridges live at NetClient;
 *  TileMesh announces domain events and the owner aggregates them. */
export interface TileMeshCallbacks {
  /** Fired when lockstep advances a tick. `state` is the just-advanced state. */
  readonly onTickAdvance: (state: GridState, tick: Tick, hash: string) => void;
  /** Fired when a remote peer completes HELLO. */
  readonly onPeerJoin: (peerId: PlayerId) => void;
  /** Fired when a remote peer leaves (transport disconnect, BYE, or eviction). */
  readonly onPeerLeave: (peerId: PlayerId) => void;
  /** Fired when an eviction vote concludes — even for self. */
  readonly onEvict: (peerId: PlayerId, reason: EvictReason) => void;
  /** Fired when this mesh's peers kick us out. Owner decides whether to
   *  stop the whole NetClient (Stage 14b) or just this mesh (Stage 17b). */
  readonly onKicked: () => void;
}

export interface TileMeshConfig {
  readonly tile: TileId;
  readonly identity: NetIdentity;
  readonly initialState: GridState;
}

export interface TileMeshDeps {
  /** Pre-bound to the mesh's tile by the NetClient orchestrator — the tile
   *  is already baked into the closure, so the factory takes no arguments. */
  readonly roomFactory: () => Promise<Room>;
  readonly clock: () => number;
}

/** A NetClient's per-tile brain. Owns the lockstep, peer registry, hash
 *  consensus, and eviction tracking for a single tile. Owner (NetClient)
 *  orchestrates across multiple meshes and handles global state. */
export class TileMesh {
  readonly tile: TileId;

  private readonly cfg: TileMeshConfig;
  private readonly deps: TileMeshDeps;
  private readonly cb: TileMeshCallbacks;

  private readonly localId: PlayerId;
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
  private currentChainHash: Uint8Array = GENESIS_HASH;

  constructor(cfg: TileMeshConfig, deps: TileMeshDeps, cb: TileMeshCallbacks) {
    this.tile = cfg.tile;
    this.cfg = cfg;
    this.deps = deps;
    this.cb = cb;
    this.localId = cfg.identity.id;
    this.registry = new PeerRegistry(this.localId, cfg.identity.joinedAt);
    this.lockstep = new Lockstep({
      localId: this.localId,
      initialState: cfg.initialState,
      clock: deps.clock,
    });
  }

  // ---- Read-only accessors ----

  get currentState(): GridState {
    return this.lockstep.currentState;
  }

  get isPaused(): boolean {
    return this.lockstep.isPaused;
  }

  get stateHash(): string {
    return this.cachedHash;
  }

  get chainHash(): Uint8Array {
    return this.currentChainHash;
  }

  get peers(): ReadonlySet<PlayerId> {
    return this.lockstep.expectedPeers;
  }

  get isStopped(): boolean {
    return this.stopped;
  }

  // ---- Lifecycle ----

  async start(): Promise<void> {
    dbg(`mesh[${this.localId}@${this.tile.x},${this.tile.y}]: start`);
    this.room = await this.deps.roomFactory();
    this.room.onCtrl((raw, sid) => this.onMessage(raw, sid));
    this.room.onTick((raw, sid) => this.onMessage(raw, sid));
    this.room.onPeerLeave((sid) => this.onTransportLeave(sid));
    this.room.onPeerJoin(() => this.broadcastHello());
    this.broadcastHello();
    dbg(`mesh[${this.localId}@${this.tile.x},${this.tile.y}]: HELLO broadcast`);
    this.seedTimer = setTimeout(() => {
      if (this.lockstep.isPaused) {
        dbg(
          `mesh[${this.localId}@${this.tile.x},${this.tile.y}]: seed timeout — no peers, unpausing`,
        );
        this.lockstep.unpause();
      }
    }, SEED_TIMEOUT_MS);
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    if (this.seedTimer !== null) {
      clearTimeout(this.seedTimer);
      this.seedTimer = null;
    }
    if (this.room) {
      this.room.sendCtrl(encodeMessage({ v: 1, t: 'BYE', from: this.localId }));
      await this.room.leave();
      this.room = null;
    }
  }

  /** Midnight reset for this mesh. Clears all transient per-tile state
   *  while keeping the room connection intact (peers reset independently
   *  on their own midnight detection). */
  reset(state: GridState): void {
    this.lockstep.reset(state);
    this.hashCheck.clear();
    this.evictTracker.clear();
    this.faultCounts.clear();
    this.pendingStateResponses.clear();
    this.currentChainHash = GENESIS_HASH;
    this.cachedHash = '';
    dbg(`mesh[${this.localId}@${this.tile.x},${this.tile.y}]: reset at tick ${state.tick}`);
  }

  // ---- Local input + tick advancement ----

  setLocalInput(turn: Turn): void {
    this.lockstep.setLocalInput(turn);
    this.broadcastLocalInput();
  }

  runOnce(now: number): GridState | null {
    if (this.stopped || this.room === null) return null;
    // Freeze detection.
    if (this.lastRunOnceAt > 0 && now - this.lastRunOnceAt > FREEZE_THRESHOLD_MS) {
      if (!this.lockstep.isPaused && this.registry.size > 0) {
        dbg(
          `mesh[${this.localId}@${this.tile.x},${this.tile.y}]: freeze detected (gap=${now - this.lastRunOnceAt}ms)`,
        );
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
        `lockstep[${this.localId}@${this.tile.x},${this.tile.y}]: advance tick=${result.tick} ${result.turnsSummary} → hash=${this.cachedHash}`,
      );
    }
    this.drainPendingStateResponses();
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
      this.currentChainHash = computeChainHash(
        this.currentChainHash,
        this.cachedHash,
        newState.tick,
      );
    }
    this.cb.onTickAdvance(newState, result.tick, this.cachedHash);
    return newState;
  }

  // ---- Outbound network primitives (used by NetClient for daemon support) ----

  /** Broadcast an INPUT on behalf of a peer (used by daemon bridges). */
  broadcastInput(from: PlayerId, tick: Tick, turn: Turn): void {
    if (this.room === null || this.stopped) return;
    this.room.sendTick(encodeMessage({ v: 1, t: 'INPUT', from, tick, i: turn }));
  }

  /** Broadcast a HELLO on behalf of a daemon deployed to this tile. */
  broadcastDaemonHello(config: {
    daemonId: string;
    colorSeed: number;
  }): void {
    if (this.room === null || this.stopped) return;
    this.room.sendCtrl(
      encodeMessage({
        v: 1,
        t: 'HELLO',
        from: config.daemonId,
        color: [
          config.colorSeed & 0xff,
          (config.colorSeed >> 8) & 0xff,
          (config.colorSeed >> 16) & 0xff,
        ],
        color_seed: config.colorSeed,
        kind: 'daemon',
        client: 'grid/0.2.0',
        joined_at: Math.floor(Date.now() / 1000),
      }),
    );
  }

  /** Direct access to lockstep operations for daemon bridges. */
  addPeer(id: PlayerId): void {
    this.lockstep.addPeer(id);
  }
  removePeer(id: PlayerId): void {
    this.lockstep.removePeer(id);
  }
  queueJoin(req: { id: PlayerId; colorSeed: number }): void {
    this.lockstep.queueJoin(req);
  }
  recordRemoteInput(msg: InputMsg): 'ok' | 'stale' | 'ignored' {
    return this.lockstep.recordRemoteInput(msg);
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
    dbg(`mesh[${this.localId}@${this.tile.x},${this.tile.y}]: dispatch ${msg.t} from ${msg.from}`);
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
        this.cb.onKicked();
        break;
      case 'BYE': {
        // BYE carries the peer's player id (wire-protocol namespace), but
        // onTransportLeave is keyed by transport session id. Resolve the
        // session via the registry so the peer is actually removed. If the
        // transport-leave event follows shortly after (normal case), it
        // finds no registered session and becomes a no-op — no double-fire.
        const sid = this.registry.sessionFor(msg.from);
        if (sid !== undefined) this.onTransportLeave(sid);
        break;
      }
    }
  }

  // ---- Internal: message handlers ----

  private handleHello(msg: HelloMsg, sessionId: string): void {
    // Reject ghost peers (a stale presence from our own prior session).
    if (msg.from === this.localId) {
      dbg(
        `mesh[${this.localId}@${this.tile.x},${this.tile.y}]: ignoring HELLO from self (session=${sessionId})`,
      );
      return;
    }
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
      dbg(
        `mesh[${this.localId}@${this.tile.x},${this.tile.y}]: ${msg.from} is senior; sending STATE_REQUEST`,
      );
      this.sendStateRequest(msg.from);
    } else {
      dbg(
        `mesh[${this.localId}@${this.tile.x},${this.tile.y}]: ${msg.from} is junior; queueing join + response`,
      );
      this.lockstep.unpause();
      if (this.seedTimer !== null) {
        clearTimeout(this.seedTimer);
        this.seedTimer = null;
      }
      this.lockstep.queueJoin({ id: msg.from, colorSeed: msg.color_seed });
      this.pendingStateResponses.add(msg.from);
    }
    this.cb.onPeerJoin(msg.from);
  }

  private handleInput(msg: InputMsg): void {
    const result = this.lockstep.recordRemoteInput(msg);
    if (result === 'stale' && this.lockstep.isAutoDefaulted(msg.from)) {
      if (!this.pendingStateResponses.has(msg.from)) {
        dbg(
          `mesh[${this.localId}@${this.tile.x},${this.tile.y}]: stale INPUT from ${msg.from}; queueing STATE_RESPONSE`,
        );
        this.pendingStateResponses.add(msg.from);
      }
    }
  }

  private handleStateHash(msg: StateHashMsg): void {
    this.hashCheck.recordRemote(msg);
    const desync = this.hashCheck.classify(msg.tick);
    if (desync === null) return;
    if (desync.minority.includes(this.localId)) {
      dbg(
        `mesh[${this.localId}@${this.tile.x},${this.tile.y}]: desync at tick ${msg.tick} — re-syncing`,
      );
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
      this.cb.onKicked();
      return;
    }
    this.registry.removeByPlayer(decision.target);
    this.lockstep.removePeer(decision.target);
    this.cb.onEvict(decision.target, decision.reason);
  }

  private handleStateRequest(msg: StateRequestMsg): void {
    if (!this.registry.peers.has(msg.from)) return;
    this.pendingStateResponses.add(msg.from);
    dbg(
      `mesh[${this.localId}@${this.tile.x},${this.tile.y}]: queued STATE_RESPONSE for ${msg.from}`,
    );
  }

  private handleStateResponse(msg: StateResponseMsg): void {
    if (msg.to !== this.localId) return;
    if (msg.from === this.localId) {
      dbg(`mesh[${this.localId}@${this.tile.x},${this.tile.y}]: ignoring STATE_RESPONSE from self`);
      return;
    }
    const { state } = installSnapshot(msg);
    // Reject snapshots with incompatible grid dimensions — they're from a
    // different game session that reused the same room name.
    const local = this.cfg.initialState.config;
    if (state.config.width !== local.width || state.config.height !== local.height) {
      dbg(
        `mesh[${this.localId}@${this.tile.x},${this.tile.y}]: rejecting snapshot from ${msg.from} — grid ${state.config.width}x${state.config.height} ≠ local ${local.width}x${local.height}`,
      );
      return;
    }
    dbg(
      `mesh[${this.localId}@${this.tile.x},${this.tile.y}]: installing snapshot from ${msg.from} at tick ${state.tick}`,
    );
    this.lockstep.reset(state);
    for (const pid of state.players.keys()) {
      if (pid !== this.localId) this.lockstep.addPeer(pid);
    }
  }

  // ---- Internal: outbound helpers ----

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
        `mesh[${this.localId}@${this.tile.x},${this.tile.y}]: sent STATE_RESPONSE to ${pid} at tick ${this.lockstep.currentTick}`,
      );
    }
    this.pendingStateResponses.clear();
  }

  private onTransportLeave(sessionId: string): void {
    // Drop the fault tally regardless of registry hit — a rogue session that
    // never HELLO'd can still have accumulated faults before the transport
    // dropped it. Keyed by session, so it must be cleaned up here.
    this.faultCounts.delete(sessionId);
    const pid = this.registry.removeBySession(sessionId);
    if (pid !== undefined) {
      this.lockstep.removePeer(pid);
      this.evictTracker.forget(pid);
      this.pendingStateResponses.delete(pid);
      this.cb.onPeerLeave(pid);
    }
  }

  private recordFault(sessionId: string, reason: string): void {
    const n = (this.faultCounts.get(sessionId) ?? 0) + 1;
    this.faultCounts.set(sessionId, n);
    dbg(
      `mesh[${this.localId}@${this.tile.x},${this.tile.y}]: fault from ${sessionId} (${n}): ${reason}`,
    );
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
