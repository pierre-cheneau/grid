// NetClient — the public facade for GRID's networking layer.
//
// Stage 14b: NetClient now holds exactly ONE TileMesh (the player's home tile)
// and delegates all per-tile concerns (Room, Lockstep, PeerRegistry, HashCheck,
// Eviction, fault tracking, chain hash) to it. NetClient retains the global,
// cross-tile responsibilities: the listener fan-out (`on()` API), the daemon
// bridge registry, and the top-level stop decision. Wire protocol and
// determinism hash are unchanged from v0.2.
//
// Stage 17b will widen this to a set of TileMeshes (shadow-zone membership)
// using the same TileMesh class. The facade's public surface is already
// shaped for that future: listeners aggregate domain events regardless of
// how many meshes are active.
//
// See `docs/architecture/networking.md` and `src/net/tile-mesh.ts`.

import { DaemonBridge, type DaemonBridgeConfig, type DaemonBridgeDeps } from '../daemon/bridge.js';
import { createSubprocessTransport } from '../daemon/subprocess-transport.js';
import type { Config, GridState, PlayerId, Tick, Turn } from '../sim/index.js';
import { dbg } from './debug.js';
import type { EvictReason } from './messages.js';
import type { RoomFactory } from './room.js';
import type { TileId } from './tile-id.js';
import { TileMesh, type TileMeshCallbacks } from './tile-mesh.js';

export interface NetIdentity {
  readonly id: string;
  readonly colorSeed: number;
  readonly joinedAt: number;
}

export interface NetClientConfig {
  readonly roomKey: string;
  readonly identity: NetIdentity;
  readonly initialState: GridState;
  /** The player's home tile. In Stage 14b the NetClient owns exactly one
   *  TileMesh at this tile; Stage 17b will expand to shadow-zone membership. */
  readonly homeTile: TileId;
}

export interface NetClientDeps {
  readonly roomFactory: RoomFactory;
  readonly clock: () => number;
}

type TickListener = (state: GridState) => void;
type PeerListener = (peerId: PlayerId) => void;
type EvictListener = (peerId: PlayerId, reason: EvictReason) => void;

export class NetClient {
  private readonly localId: PlayerId;
  private readonly mesh: TileMesh;
  private readonly daemonBridges = new Map<string, DaemonBridge>();
  private stopped = false;

  private readonly tickListeners: TickListener[] = [];
  private readonly joinListeners: PeerListener[] = [];
  private readonly leaveListeners: PeerListener[] = [];
  private readonly evictListeners: EvictListener[] = [];

  constructor(
    private readonly cfg: NetClientConfig,
    deps: NetClientDeps,
  ) {
    this.localId = cfg.identity.id;
    const callbacks: TileMeshCallbacks = {
      onTickAdvance: (state) => this.onTickAdvance(state),
      onPeerJoin: (pid) => this.fire(this.joinListeners, pid),
      onPeerLeave: (pid) => this.fire(this.leaveListeners, pid),
      onEvict: (pid, reason) => this.fireEvict(pid, reason),
      onKicked: () => {
        void this.stop();
      },
    };
    this.mesh = new TileMesh(
      {
        tile: cfg.homeTile,
        roomKey: cfg.roomKey,
        identity: cfg.identity,
        initialState: cfg.initialState,
      },
      { roomFactory: deps.roomFactory, clock: deps.clock },
      callbacks,
    );
  }

  // ---- Read-only accessors (all delegate to the home mesh) ----

  get currentState(): GridState {
    return this.mesh.currentState;
  }

  get config(): Config {
    return this.cfg.initialState.config;
  }

  get isPaused(): boolean {
    return this.mesh.isPaused;
  }

  get stateHash(): string {
    return this.mesh.stateHash;
  }

  get chainHash(): Uint8Array {
    return this.mesh.chainHash;
  }

  get peers(): ReadonlySet<PlayerId> {
    return this.mesh.peers;
  }

  // ---- Event subscription ----

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

  // ---- Lifecycle ----

  async start(): Promise<void> {
    dbg(`client[${this.localId}]: start (homeTile=${this.cfg.homeTile.x},${this.cfg.homeTile.y})`);
    await this.mesh.start();
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    for (const bridge of this.daemonBridges.values()) bridge.stop();
    this.daemonBridges.clear();
    await this.mesh.stop();
  }

  /** Reset the simulation for a new day. Clears all transient state in the
   *  home mesh while keeping its room connection intact — peers reset
   *  independently at their own midnight detection. Running daemons are
   *  re-registered as peers of the fresh day. */
  resetForNewDay(state: GridState): void {
    this.mesh.reset(state);
    for (const bridge of this.daemonBridges.values()) {
      if (bridge.isRunning) {
        this.mesh.addPeer(bridge.daemonId);
        this.mesh.queueJoin({ id: bridge.daemonId, colorSeed: bridge.colorSeed });
      }
    }
    dbg(`client[${this.localId}]: reset for new day at tick ${state.tick}`);
  }

  // ---- Input ----

  setLocalInput(turn: Turn): void {
    this.mesh.setLocalInput(turn);
  }

  /** Deploy a daemon alongside the pilot. The daemon becomes a second local
   *  player whose inputs are injected into the home-tile lockstep and
   *  broadcast to peers in that tile. */
  async deployDaemon(config: DaemonBridgeConfig): Promise<{ sourceBytes: number }> {
    if (this.stopped) throw new Error('cannot deploy daemon after NetClient.stop()');
    const existing = this.daemonBridges.get(config.daemonId);
    if (existing) {
      existing.stop();
      this.daemonBridges.delete(config.daemonId);
    }
    const deps: DaemonBridgeDeps = {
      broadcastInput: (id, tick, turn) => this.broadcastDaemonInput(id, tick, turn),
      addPeer: (id) => this.mesh.addPeer(id),
      removePeer: (id) => this.mesh.removePeer(id),
      queueJoin: (req) => this.mesh.queueJoin(req),
      recordInput: (msg) => this.mesh.recordRemoteInput(msg),
      createTransport: (path) => createSubprocessTransport(path),
    };
    const bridge = new DaemonBridge(config, deps);
    await bridge.start();
    this.daemonBridges.set(config.daemonId, bridge);
    this.mesh.broadcastDaemonHello(config);
    dbg(`client[${this.localId}]: daemon ${config.daemonId} deployed`);
    return { sourceBytes: bridge.sourceBytes };
  }

  runOnce(now: number): GridState | null {
    if (this.stopped) return null;
    return this.mesh.runOnce(now);
  }

  // ---- Internal ----

  private onTickAdvance(state: GridState): void {
    // Daemon bridges first: each daemon's CMD for the next tick is produced
    // in response to this TICK, so the sooner they see it the better.
    for (const bridge of this.daemonBridges.values()) {
      if (bridge.isRunning) bridge.onTick(state);
    }
    for (const cb of this.tickListeners) cb(state);
  }

  private broadcastDaemonInput(id: PlayerId, tick: Tick, turn: Turn): void {
    if (this.stopped) return;
    this.mesh.broadcastInput(id, tick, turn);
  }

  private fire(listeners: PeerListener[], pid: PlayerId): void {
    for (const cb of listeners) cb(pid);
  }

  private fireEvict(pid: PlayerId, reason: EvictReason): void {
    for (const cb of this.evictListeners) cb(pid, reason);
  }
}
