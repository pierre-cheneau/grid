// NetClient — the public facade for GRID's networking layer.
//
// Stage 15: NetClient owns a set of TileMeshes keyed by tile. The player's
// home tile is always present and is the authoritative source for all
// singular accessors (`currentState`, `stateHash`, `chainHash`, `peers`,
// `isPaused`) and for inputs the local player produces. Non-home meshes
// run their own lockstep and discovery but don't leak into the singular
// accessors — they exist to participate in peer discovery and consensus
// for their tile. Stage 16 will drive `addTile`/`removeTile` from the
// player's position via `shadowTilesOf(playerPos)`.
//
// Stage 14b introduced TileMesh; Stage 15 is the structural step that
// lets multiple TileMeshes coexist under one NetClient. Wire protocol
// and determinism hash remain unchanged.
//
// Listener semantics:
//   - `tick` fires only for HOME-mesh advances (the renderer consumes
//     home state). Non-home meshes advance in lockstep but produce no
//     tick events; their observability is through peer/evict listeners.
//   - `peerJoin` / `peerLeave` / `evict` fire per-mesh. A peer visible
//     in multiple meshes will currently fire once per mesh — Stage 17b
//     will deduplicate when shadow zones go live.
//
// See `src/net/tile-mesh.ts` and `docs/architecture/networking.md`.

import { DaemonBridge, type DaemonBridgeConfig, type DaemonBridgeDeps } from '../daemon/bridge.js';
import { createSubprocessTransport } from '../daemon/subprocess-transport.js';
import type { Config, GridState, PlayerId, Tick, Turn } from '../sim/index.js';
import { dbg } from './debug.js';
import type { EvictReason } from './messages.js';
import type { TileRoomFactory } from './room.js';
import { type TileId, tileEq, tileKeyOf } from './tile-id.js';
import { TileMesh, type TileMeshCallbacks } from './tile-mesh.js';

export interface NetIdentity {
  readonly id: string;
  readonly colorSeed: number;
  readonly joinedAt: number;
}

export interface NetClientConfig {
  readonly identity: NetIdentity;
  readonly initialState: GridState;
  /** The player's home tile. Always-present mesh; source of truth for the
   *  singular accessors. Stage 16+ may add more tiles via `addTile`. */
  readonly homeTile: TileId;
}

export interface NetClientDeps {
  /** Produce a tile-scoped Room. NetClient calls this once per active mesh
   *  (always for the home tile; additionally for any tile passed to
   *  `addTile`). Implementations typically capture `localId`, relay pool,
   *  and day tag in closure — only the tile varies per call. */
  readonly roomFactory: TileRoomFactory;
  readonly clock: () => number;
}

type TickListener = (state: GridState) => void;
type PeerListener = (peerId: PlayerId) => void;
type EvictListener = (peerId: PlayerId, reason: EvictReason) => void;

/**
 * Public API surface in one place:
 *
 * Home-mesh-only (singular) — return / act on the home tile's mesh:
 *   • accessors: `currentState`, `config`, `isPaused`, `stateHash`, `chainHash`, `peers`
 *   • inputs:    `setLocalInput`
 *   • daemons:   `deployDaemon`
 *   • ticks:     `on('tick', …)` listeners fire only for home-mesh advances;
 *                `runOnce(now)` returns the home mesh's advance result
 *
 * All-mesh (iterate every active TileMesh):
 *   • lifecycle: `start`, `stop`, `runOnce` (advances each), `resetForNewDay`
 *   • events:    `on('peerJoin'|'peerLeave'|'evict', …)` fan out per-mesh
 *                (Stage 15 flat fan-out; Stage 17b will deduplicate overlaps)
 *
 * Multi-tile orchestration (Stage 15+):
 *   • queries:   `hasTile`, `activeTiles`
 *   • mutators:  `addTile`, `removeTile`
 */
export class NetClient {
  private readonly localId: PlayerId;
  private readonly meshes = new Map<string, TileMesh>();
  private readonly homeTileKey: string;
  private readonly daemonBridges = new Map<string, DaemonBridge>();
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
    this.homeTileKey = tileKeyOf(cfg.homeTile);
    // The home mesh is always present. Stage 16 may add shadow meshes.
    this.meshes.set(this.homeTileKey, this.createMesh(cfg.homeTile, cfg.initialState));
  }

  // ---- Read-only accessors (singular — all delegate to the home mesh) ----

  get currentState(): GridState {
    return this.homeMesh.currentState;
  }

  get config(): Config {
    return this.cfg.initialState.config;
  }

  get isPaused(): boolean {
    return this.homeMesh.isPaused;
  }

  get stateHash(): string {
    return this.homeMesh.stateHash;
  }

  get chainHash(): Uint8Array {
    return this.homeMesh.chainHash;
  }

  get peers(): ReadonlySet<PlayerId> {
    return this.homeMesh.peers;
  }

  // ---- Multi-tile query / lifecycle (Stage 15) ----

  /** List the tiles with an active TileMesh. Always includes the home tile. */
  activeTiles(): readonly TileId[] {
    return [...this.meshes.values()].map((m) => m.tile);
  }

  hasTile(tile: TileId): boolean {
    return this.meshes.has(tileKeyOf(tile));
  }

  /** Create and start a new TileMesh at `tile`. Idempotent: a no-op if the
   *  mesh already exists. Throws if the NetClient has been stopped. If
   *  `mesh.start()` fails (e.g., the room factory rejects), the in-flight
   *  entry is removed from the map so `activeTiles()` reflects reality. */
  async addTile(tile: TileId): Promise<void> {
    if (this.stopped) throw new Error('cannot addTile after NetClient.stop()');
    const key = tileKeyOf(tile);
    if (this.meshes.has(key)) return;
    const mesh = this.createMesh(tile, this.cfg.initialState);
    this.meshes.set(key, mesh);
    dbg(`client[${this.localId}]: addTile(${tile.x},${tile.y})`);
    try {
      await mesh.start();
    } catch (err) {
      this.meshes.delete(key);
      throw err;
    }
  }

  /** Stop and remove the TileMesh at `tile`. Idempotent: a no-op if no
   *  such mesh exists. Throws if `tile` is the home tile (the home mesh
   *  is the client's authoritative state and cannot be removed). */
  async removeTile(tile: TileId): Promise<void> {
    if (tileEq(tile, this.cfg.homeTile)) {
      throw new Error(`cannot removeTile: ${tileKeyOf(tile)} is the home tile`);
    }
    const key = tileKeyOf(tile);
    const mesh = this.meshes.get(key);
    if (mesh === undefined) return;
    this.meshes.delete(key);
    dbg(`client[${this.localId}]: removeTile(${tile.x},${tile.y})`);
    await mesh.stop();
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
    // Parallel start: in steady state there is exactly one mesh; this
    // structure also covers Stage 16 where multiple meshes boot at once.
    await Promise.all([...this.meshes.values()].map((m) => m.start()));
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    for (const bridge of this.daemonBridges.values()) bridge.stop();
    this.daemonBridges.clear();
    await Promise.all([...this.meshes.values()].map((m) => m.stop()));
    // Keep the Map populated so accessors still resolve (getters return the
    // stale home mesh's final state); clearing would break post-stop reads.
  }

  /** Reset every mesh for a new day. Daemons are re-registered as peers
   *  in the home mesh (they remain the local player's companions across
   *  the midnight boundary). */
  resetForNewDay(state: GridState): void {
    for (const mesh of this.meshes.values()) mesh.reset(state);
    const home = this.homeMesh;
    for (const bridge of this.daemonBridges.values()) {
      if (bridge.isRunning) {
        home.addPeer(bridge.daemonId);
        home.queueJoin({ id: bridge.daemonId, colorSeed: bridge.colorSeed });
      }
    }
    dbg(`client[${this.localId}]: reset for new day at tick ${state.tick}`);
  }

  // ---- Input ----

  setLocalInput(turn: Turn): void {
    // The local player lives in the home tile. Non-home meshes don't
    // receive local inputs — they have no local player to drive.
    this.homeMesh.setLocalInput(turn);
  }

  /** Deploy a daemon alongside the pilot in the home tile. */
  async deployDaemon(config: DaemonBridgeConfig): Promise<{ sourceBytes: number }> {
    if (this.stopped) throw new Error('cannot deploy daemon after NetClient.stop()');
    const existing = this.daemonBridges.get(config.daemonId);
    if (existing) {
      existing.stop();
      this.daemonBridges.delete(config.daemonId);
    }
    const home = this.homeMesh;
    const deps: DaemonBridgeDeps = {
      broadcastInput: (id, tick, turn) => this.broadcastDaemonInput(id, tick, turn),
      addPeer: (id) => home.addPeer(id),
      removePeer: (id) => home.removePeer(id),
      queueJoin: (req) => home.queueJoin(req),
      recordInput: (msg) => home.recordRemoteInput(msg),
      createTransport: (path) => createSubprocessTransport(path),
    };
    const bridge = new DaemonBridge(config, deps);
    await bridge.start();
    this.daemonBridges.set(config.daemonId, bridge);
    home.broadcastDaemonHello(config);
    dbg(`client[${this.localId}]: daemon ${config.daemonId} deployed at home tile`);
    return { sourceBytes: bridge.sourceBytes };
  }

  /** Advance every mesh by up to one tick. Returns the home mesh's advance
   *  result (or null if it didn't advance); non-home meshes advance silently.
   *  The CLI consumes the return value for rendering. */
  runOnce(now: number): GridState | null {
    if (this.stopped) return null;
    let homeState: GridState | null = null;
    for (const mesh of this.meshes.values()) {
      const state = mesh.runOnce(now);
      if (mesh === this.homeMesh) homeState = state;
    }
    return homeState;
  }

  // ---- Internal ----

  private get homeMesh(): TileMesh {
    // The home mesh is set at construction and never removed. Non-null by
    // construction; the assertion protects against future invariant drift.
    const mesh = this.meshes.get(this.homeTileKey);
    if (mesh === undefined) throw new Error('invariant: home mesh missing');
    return mesh;
  }

  private createMesh(tile: TileId, initialState: GridState): TileMesh {
    const isHome = tileEq(tile, this.cfg.homeTile);
    const callbacks: TileMeshCallbacks = {
      // Only the home mesh's tick advances are forwarded to listeners; the
      // renderer consumes home state and shouldn't see noisy non-home ticks.
      onTickAdvance: isHome ? (state) => this.onHomeTickAdvance(state) : () => {},
      onPeerJoin: (pid) => this.fire(this.joinListeners, pid),
      onPeerLeave: (pid) => this.fire(this.leaveListeners, pid),
      onEvict: (pid, reason) => this.fireEvict(pid, reason),
      onKicked: () => {
        // Stage 15: any mesh being kicked is a fatal signal — we stop the
        // whole client. Stage 17b may narrow this to per-mesh teardown.
        void this.stop();
      },
    };
    return new TileMesh(
      { tile, identity: this.cfg.identity, initialState },
      { roomFactory: () => this.deps.roomFactory(tile), clock: this.deps.clock },
      callbacks,
    );
  }

  private onHomeTickAdvance(state: GridState): void {
    // Daemon bridges first: each daemon's CMD for the next tick is produced
    // in response to this TICK, so the sooner they see it the better.
    for (const bridge of this.daemonBridges.values()) {
      if (bridge.isRunning) bridge.onTick(state);
    }
    for (const cb of this.tickListeners) cb(state);
  }

  private broadcastDaemonInput(id: PlayerId, tick: Tick, turn: Turn): void {
    if (this.stopped) return;
    this.homeMesh.broadcastInput(id, tick, turn);
  }

  private fire(listeners: PeerListener[], pid: PlayerId): void {
    for (const cb of listeners) cb(pid);
  }

  private fireEvict(pid: PlayerId, reason: EvictReason): void {
    for (const cb of this.evictListeners) cb(pid, reason);
  }
}
