#!/usr/bin/env node
// GRID — CLI driver. Wires NetClient + Nostr persistence + intro + renderer + epitaph.
//
// Flow: resolveIdentity → NostrPool → cold start (Nostr/local/empty) → client.start()
// → tryMaximize → playIntro → game loop (10fps render + Nostr publish) → shutdown.

import { createWriteStream } from 'node:fs';
import { basename, extname, resolve } from 'node:path';
import { argv, exit, pid, stdin, stdout } from 'node:process';
import { daemonColorSeed, daemonPlayerId } from '../daemon/id.js';
import { resolveIdentity } from '../id/cache.js';
import { rebaseIdentity } from '../id/identity.js';
import type { LocalIdentity } from '../id/identity.js';
import { TICK_DURATION_MS } from '../net/constants.js';
import { setDebugLogger } from '../net/debug.js';
import { NetClient } from '../net/index.js';
import { createNostrRoom } from '../net/nostr-room.js';
import { NostrPool } from '../net/nostr.js';
import { dayStartMs, seedFromDay, tickAtTime, todayTag } from '../net/time.js';
import {
  NostrPublisher,
  compressSnapshot,
  decodeSnapshot,
  decompressSnapshot,
  encodeSnapshot,
  filterExpiredCells,
  loadLocalSnapshot,
  loadNostrSnapshot,
  saveLocalSnapshot,
} from '../persist/index.js';
import { rgbFromColorSeed } from '../render/color.js';
import {
  AnsiWriter,
  type Camera,
  type Viewport,
  buildFrame,
  cleanupTerminal,
  createSessionTracker,
  playIntro,
  renderEpitaph,
  tryMaximize,
} from '../render/index.js';
import type { SessionTracker } from '../render/session.js';
import {
  type Config,
  type GridState,
  type Player,
  TICKS_PER_SECOND,
  hashState,
  newRng,
} from '../sim/index.js';
import { DayTracker, computeAllCrowns } from '../stats/index.js';
import type { Crown } from '../stats/types.js';

interface CliConfig {
  readonly room: string;
  readonly width: number;
  readonly height: number;
  readonly seed: bigint;
  readonly halfLifeTicks: number;
  readonly name: string | null;
  readonly debug: boolean;
  readonly relayUrls: ReadonlyArray<string>;
  readonly deploy: string | null;
  readonly inprocess: boolean;
}

/** How long the recap text is shown in the status bar after midnight (ms). */
const RECAP_DISPLAY_MS = 5000;

interface RendererHandle {
  render(state: GridState | null, hash?: string, recapText?: string): void;
  shutdown(): void;
}

function parseArgs(args: ReadonlyArray<string>): CliConfig {
  const opts: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined || !arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = args[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      opts[key] = next;
      i++;
    } else {
      opts[key] = 'true';
    }
  }
  return {
    room: opts['room'] ?? `grid:${todayTag(Date.now())}`,
    // Raw overrides — null means "auto-size to terminal after maximize".
    width: opts['width'] ? Number.parseInt(opts['width'], 10) : 0,
    height: opts['height'] ? Number.parseInt(opts['height'], 10) : 0,
    seed: opts['seed'] ? BigInt(opts['seed']) : 0xc0ffee_deadbeefn,
    halfLifeTicks: opts['half-life-ticks'] ? Number.parseInt(opts['half-life-ticks'], 10) : 600,
    name: opts['name'] ?? null,
    debug: opts['debug'] === 'true',
    relayUrls: opts['relay'] ? opts['relay'].split(',') : [],
    deploy: opts['deploy'] ?? null,
    inprocess: opts['inprocess'] === 'true',
  };
}

function makeGameConfig(cfg: CliConfig): Config {
  return {
    width: cfg.width,
    height: cfg.height,
    halfLifeTicks: cfg.halfLifeTicks,
    seed: cfg.seed,
    circular: true,
  };
}

function makeLocalPlayer(localId: string, colorSeed: number, w: number, h: number): Player {
  return {
    id: localId,
    pos: { x: Math.floor(w / 2), y: Math.floor(h / 2) },
    dir: 1,
    isAlive: true,
    respawnAtTick: null,
    score: 0,
    colorSeed,
  };
}

/** Cold start cell loader: try Nostr, fall back to local file, fall back to empty. */
async function loadColdStartCells(
  pool: NostrPool,
  dayTag: string,
  config: Config,
  currentTick: number,
  debug: boolean,
): Promise<Map<string, import('../sim/index.js').Cell>> {
  const nostrResult = await loadNostrSnapshot(pool, dayTag, config, currentTick).catch(() => null);
  if (nostrResult !== null) {
    if (debug) {
      process.stderr.write(`grid: loaded ${nostrResult.cells.size} cells from Nostr\n`);
    }
    return nostrResult.cells;
  }
  const persistedBytes = await loadLocalSnapshot(dayTag);
  if (persistedBytes !== null) {
    try {
      const raw = decompressSnapshot(persistedBytes);
      const snap = decodeSnapshot(raw);
      const freshCells = filterExpiredCells(snap.cells, currentTick, snap.config.halfLifeTicks);
      if (debug) {
        process.stderr.write(
          `grid: loaded ${freshCells.size} cells from local snapshot (${snap.cells.size} total, ${snap.cells.size - freshCells.size} expired)\n`,
        );
      }
      return freshCells;
    } catch {
      // fall through to empty
    }
  }
  return new Map();
}

function makeInitialState(
  cfg: CliConfig,
  localId: string,
  colorSeed: number,
  tick: number,
  cells: Map<string, import('../sim/index.js').Cell> = new Map(),
): GridState {
  const config = makeGameConfig(cfg);
  const player = makeLocalPlayer(localId, colorSeed, cfg.width, cfg.height);
  return {
    tick,
    config,
    rng: newRng(cfg.seed),
    players: new Map([[localId, player]]),
    cells,
  };
}

function setupRenderer(
  localId: string,
  writer: AnsiWriter | null,
  worldW: number,
  worldH: number,
): RendererHandle {
  if (!writer) {
    let lastPrinted = 0;
    return {
      render(state) {
        if (state === null) return;
        if (state.tick - lastPrinted < TICKS_PER_SECOND) return;
        lastPrinted = state.tick;
        const h = hashState(state);
        stdout.write(`[t=${state.tick}] peers=${state.players.size} hash=${h}\n`);
      },
      shutdown() {},
    };
  }
  let viewport: Viewport = { cols: stdout.columns ?? 80, rows: stdout.rows ?? 24 };
  stdout.on('resize', () => {
    viewport = { cols: stdout.columns ?? 80, rows: stdout.rows ?? 24 };
  });
  // Camera tracks the local player's position. On death, stays at the death
  // position so the player can see what killed them.
  let lastCamera: Camera = { x: Math.floor(worldW / 2), y: Math.floor(worldH / 2) };
  return {
    render(state, hash, recapText?) {
      if (state === null) return;
      const me = state.players.get(localId);
      if (me?.isAlive) lastCamera = { x: me.pos.x, y: me.pos.y };
      writer.endFrame(buildFrame(state, viewport, lastCamera, localId, hash, recapText));
    },
    shutdown() {
      writer.shutdown();
    },
  };
}

function setupShutdown(
  client: NetClient,
  renderer: RendererHandle,
  tracker: SessionTracker,
  publisher: NostrPublisher,
  pool: NostrPool,
  id: LocalIdentity,
  getDayTag: () => string,
  getCrowns: () => Crown[],
): () => Promise<void> {
  let stopping = false;
  return async () => {
    if (stopping) return;
    stopping = true;
    renderer.shutdown();

    // Persist cell state for the next session (best-effort).
    const state = client.currentState;
    const currentDayTag = getDayTag();
    if (state.cells.size > 0) {
      const raw = encodeSnapshot({ tick: state.tick, config: state.config, cells: state.cells });
      await saveLocalSnapshot(currentDayTag, compressSnapshot(raw)).catch(() => {});
      // Await the final Nostr publish so relay sockets aren't torn down mid-flight.
      await publisher.publishNow(
        state.tick,
        state.cells,
        client.stateHash,
        client.chainHash,
        state.players.size,
      );
    }

    // Stop the client (which leaves the room and tears down WebRTC connections)
    // BEFORE closing the pool — otherwise in-flight signaling publishes from
    // room.leave() would hit a closed relay pool.
    await client.stop();
    pool.close();

    const stats = tracker.finalize(Date.now());
    const crowns = getCrowns();
    stdout.write(
      renderEpitaph(
        {
          identity: id.id,
          identityColor: rgbFromColorSeed(id.colorSeed),
          durationMs: stats.durationMs,
          derezzes: stats.derezzes,
          deaths: stats.deaths,
          longestRunMs: stats.longestRunMs,
          ...(crowns.length > 0 ? { crowns, dayTag: currentDayTag } : {}),
        },
        stdout.columns ?? 80,
      ),
    );
    exit(0);
  };
}

function setupKeyboard(client: NetClient, shutdown: () => Promise<void>): void {
  if (stdin.isTTY) stdin.setRawMode(true);
  stdin.resume();
  stdin.on('data', (chunk) => {
    const s = chunk.toString();
    if (s === 'q' || s === '\x03' || s === '\x1b') {
      void shutdown();
      return;
    }
    if (s === '\x1b[D') client.setLocalInput('L');
    else if (s === '\x1b[C') client.setLocalInput('R');
  });
}

async function main(): Promise<void> {
  // Dispatch to forge if the first arg is "forge".
  if (argv[2] === 'forge') {
    const { runForgeCli } = await import('../daemon/forge/cli.js');
    await runForgeCli(argv.slice(3));
    return;
  }

  const cfg = parseArgs(argv.slice(2));
  if (cfg.debug) {
    const path = `./grid-debug-${pid}.log`;
    const stream = createWriteStream(path, { flags: 'a' });
    setDebugLogger((msg) => stream.write(`${new Date().toISOString()} ${msg}\n`));
    process.stderr.write(`grid: debug log → ${path}\n`);
  }

  // Maximize BEFORE computing grid dimensions so the grid fills the
  // post-maximize terminal, not the pre-maximize one.
  const writer = stdout.isTTY ? new AnsiWriter({ stdout }) : null;
  if (writer) {
    writer.begin();
    await tryMaximize(stdout);
  }

  // World dimensions (in cells). Default 500×500 circular — each cell renders as
  // 2 terminal chars wide, so a square grid looks square on screen. Override via
  // --width/--height for testing.
  const gridW = cfg.width > 0 ? cfg.width : 250;
  const gridH = cfg.height > 0 ? cfg.height : 250;
  const gridCfg = { ...cfg, width: gridW, height: gridH };

  // Time-anchored ticks: the tick number corresponds to wall-clock time within
  // the day. This means cells decay in real time even when no peers are online.
  const now = Date.now();
  const dayStart = dayStartMs(now);
  const currentTick = tickAtTime(now, dayStart);
  const dayTag = todayTag(now);

  const baseId = await resolveIdentity();
  const id = cfg.name === null ? baseId : rebaseIdentity(baseId, cfg.name);

  // Nostr relay pool for persistence (cell snapshots, chain attestations).
  const pool = new NostrPool({
    seckey: id.nostrSeckey,
    pubkey: id.nostrPubkey,
    ...(gridCfg.relayUrls.length > 0 ? { relayUrls: gridCfg.relayUrls } : {}),
  });

  // Cold start: Nostr (global) → local file (own session) → empty grid.
  const gameConfig = makeGameConfig(gridCfg);
  const cells = await loadColdStartCells(pool, dayTag, gameConfig, currentTick, cfg.debug);
  const initialState = makeInitialState(gridCfg, id.id, id.colorSeed, currentTick, cells);

  const client = new NetClient(
    {
      roomKey: gridCfg.room,
      identity: id,
      initialState,
    },
    {
      roomFactory: async () =>
        createNostrRoom({
          pool,
          dayTag,
          localPubkey: id.nostrPubkey,
        }),
      clock: Date.now,
    },
  );
  await client.start();

  // Intro animation overlaps with the WebRTC handshake.
  if (writer) {
    await playIntro(
      writer,
      {
        cols: stdout.columns ?? 80,
        rows: stdout.rows ?? 24,
        identity: id.id,
        identityColor: rgbFromColorSeed(id.colorSeed),
      },
      Math.floor(Date.now() / 1000),
    );
    // No screen clear needed — the first game frame fills the entire viewport,
    // overwriting the intro seamlessly.
  }

  // Deploy daemon if requested.
  if (cfg.deploy !== null) {
    const scriptPath = resolve(cfg.deploy);
    const base = basename(scriptPath, extname(scriptPath));
    const dId = daemonPlayerId(base, id.id);
    const dColor = daemonColorSeed(dId);
    await client.deployDaemon({
      scriptPath,
      daemonId: dId,
      colorSeed: dColor,
      gridWidth: gridW,
      gridHeight: gridH,
    });
    if (cfg.debug) process.stderr.write(`grid: daemon ${dId} deployed\n`);
  }

  const tracker = createSessionTracker(Date.now());
  const renderer = setupRenderer(id.id, writer, gridW, gridH);
  const publisher = new NostrPublisher(pool, dayTag, gameConfig);

  // Midnight reset state.
  let currentDay = dayTag;
  let dayTracker = new DayTracker();
  let lastCrowns: Crown[] = [];
  let recapEndAt = 0;
  let recapLine = '';

  const shutdown = setupShutdown(
    client,
    renderer,
    tracker,
    publisher,
    pool,
    id,
    () => currentDay,
    () => lastCrowns,
  );
  setupKeyboard(client, shutdown);
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
  setInterval(
    () => {
      const now = Date.now();

      // Midnight detection: compare day tags to detect UTC day boundary.
      const newDay = todayTag(now);
      if (newDay !== currentDay) {
        // Compute crowns from the day that just ended.
        const dayStats = dayTracker.snapshot(now);
        const sessionSnap = tracker.snapshot(now);
        lastCrowns = computeAllCrowns(dayStats, sessionSnap, id.id);

        // Save final cell snapshot for the ended day (local + Nostr).
        const state = client.currentState;
        if (state.cells.size > 0) {
          const raw = encodeSnapshot({
            tick: state.tick,
            config: state.config,
            cells: state.cells,
          });
          saveLocalSnapshot(currentDay, compressSnapshot(raw)).catch(() => {});
          publisher
            .publishNow(
              state.tick,
              state.cells,
              client.stateHash,
              client.chainHash,
              state.players.size,
            )
            .catch(() => {});
        }

        // Show recap in the status bar briefly after midnight.
        recapLine = lastCrowns.map((c) => c.label).join(' · ') || 'no crowns today';
        recapEndAt = now + RECAP_DISPLAY_MS;

        // Reset for the new day.
        const newDayStart = dayStartMs(now);
        const newTick = tickAtTime(now, newDayStart);
        const newSeed = seedFromDay(newDay);
        const newCfg = { ...gridCfg, seed: newSeed };
        client.resetForNewDay(makeInitialState(newCfg, id.id, id.colorSeed, newTick));
        publisher.resetForNewDay(newDay);
        publisher.publishWorldConfig(gridW, gridH, newSeed.toString(16));
        dayTracker = new DayTracker();
        currentDay = newDay;
      }

      // Normal tick.
      const result = client.runOnce(now);
      if (result !== null) {
        const me = result.players.get(id.id);
        if (me) tracker.update(me.isAlive, me.score, now);
        dayTracker.observe(result, now);
        publisher.onTick(
          result.tick,
          result.cells,
          client.stateHash,
          client.chainHash,
          result.players.size,
        );
        const recap = now < recapEndAt ? recapLine : undefined;
        renderer.render(result, client.stateHash, recap);
      }
    },
    Math.floor(TICK_DURATION_MS / 2),
  );
}

process.on('uncaughtException', (err: unknown) => {
  cleanupTerminal();
  process.stderr.write(`grid: uncaught: ${String(err)}\n`);
  exit(1);
});
process.on('unhandledRejection', (err: unknown) => {
  cleanupTerminal();
  process.stderr.write(`grid: unhandled: ${String(err)}\n`);
  exit(1);
});

main().catch((err: unknown) => {
  cleanupTerminal();
  process.stderr.write(`grid: fatal: ${String(err)}\n`);
  exit(1);
});
