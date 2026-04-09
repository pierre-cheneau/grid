#!/usr/bin/env node
// GRID — Stage 4 CLI driver. Wires NetClient + intro animation + renderer + epitaph.
//
// Flow: resolveIdentity → client.start() → tryMaximize → playIntro (1.5s, overlaps
// WebRTC handshake) → game loop (10fps render) → shutdown → epitaph to scrollback.

import { createWriteStream } from 'node:fs';
import { argv, exit, pid, stdin, stdout } from 'node:process';
import { resolveIdentity } from '../id/cache.js';
import { rebaseIdentity } from '../id/identity.js';
import type { LocalIdentity } from '../id/identity.js';
import { TICK_DURATION_MS } from '../net/constants.js';
import { setDebugLogger } from '../net/debug.js';
import { NetClient } from '../net/index.js';
import { createTrysteroRoom } from '../net/room.js';
import { dayStartMs, tickAtTime, todayTag } from '../net/time.js';
import {
  compressSnapshot,
  decodeSnapshot,
  decompressSnapshot,
  encodeSnapshot,
  filterExpiredCells,
  loadLocalSnapshot,
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

interface CliConfig {
  readonly room: string;
  readonly width: number;
  readonly height: number;
  readonly seed: bigint;
  readonly halfLifeTicks: number;
  readonly name: string | null;
  readonly debug: boolean;
  readonly relayUrls: ReadonlyArray<string>;
}

interface RendererHandle {
  render(state: GridState | null, hash?: string): void;
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
    halfLifeTicks: opts['half-life-ticks'] ? Number.parseInt(opts['half-life-ticks'], 10) : 100,
    name: opts['name'] ?? null,
    debug: opts['debug'] === 'true',
    relayUrls: opts['relay'] ? opts['relay'].split(',') : [],
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

function makeInitialState(
  cfg: CliConfig,
  localId: string,
  colorSeed: number,
  tick: number,
): GridState {
  const config = makeGameConfig(cfg);
  const player = makeLocalPlayer(localId, colorSeed, cfg.width, cfg.height);
  return {
    tick,
    config,
    rng: newRng(cfg.seed),
    players: new Map([[localId, player]]),
    cells: new Map(),
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
    render(state, hash) {
      if (state === null) return;
      const me = state.players.get(localId);
      if (me?.isAlive) lastCamera = { x: me.pos.x, y: me.pos.y };
      writer.endFrame(buildFrame(state, viewport, lastCamera, localId, hash));
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
  id: LocalIdentity,
  dayTag: string,
): () => Promise<void> {
  let stopping = false;
  return async () => {
    if (stopping) return;
    stopping = true;
    renderer.shutdown();

    // Persist cell state for the next session (best-effort).
    const state = client.currentState;
    if (state.cells.size > 0) {
      const raw = encodeSnapshot({ tick: state.tick, config: state.config, cells: state.cells });
      await saveLocalSnapshot(dayTag, compressSnapshot(raw)).catch(() => {});
    }

    const stats = tracker.finalize(Date.now());
    stdout.write(
      renderEpitaph(
        {
          identity: id.id,
          identityColor: rgbFromColorSeed(id.colorSeed),
          durationMs: stats.durationMs,
          derezzes: stats.derezzes,
          deaths: stats.deaths,
          longestRunMs: stats.longestRunMs,
        },
        stdout.columns ?? 80,
      ),
    );
    await client.stop();
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

  // Cold start: try loading persisted cell state from a previous session today.
  let initialState: GridState;
  const persistedBytes = await loadLocalSnapshot(dayTag);
  if (persistedBytes !== null) {
    try {
      const raw = decompressSnapshot(persistedBytes);
      const snap = decodeSnapshot(raw);
      const freshCells = filterExpiredCells(snap.cells, currentTick, snap.config.halfLifeTicks);
      const player = makeLocalPlayer(id.id, id.colorSeed, gridW, gridH);
      initialState = {
        tick: currentTick,
        config: makeGameConfig(gridCfg),
        rng: newRng(gridCfg.seed),
        players: new Map([[id.id, player]]),
        cells: freshCells,
      };
      if (cfg.debug) {
        process.stderr.write(
          `grid: loaded ${freshCells.size} cells from local snapshot (${snap.cells.size} total, ${snap.cells.size - freshCells.size} expired)\n`,
        );
      }
    } catch {
      initialState = makeInitialState(gridCfg, id.id, id.colorSeed, currentTick);
    }
  } else {
    initialState = makeInitialState(gridCfg, id.id, id.colorSeed, currentTick);
  }

  const client = new NetClient(
    {
      roomKey: gridCfg.room,
      identity: id,
      initialState,
    },
    {
      roomFactory: (roomKey, peerId) =>
        createTrysteroRoom(roomKey, peerId, {
          relayUrls: gridCfg.relayUrls.length > 0 ? gridCfg.relayUrls : undefined,
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

  const tracker = createSessionTracker(Date.now());
  const renderer = setupRenderer(id.id, writer, gridW, gridH);
  const shutdown = setupShutdown(client, renderer, tracker, id, dayTag);
  setupKeyboard(client, shutdown);
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
  setInterval(
    () => {
      const result = client.runOnce(Date.now());
      if (result !== null) {
        const me = result.players.get(id.id);
        if (me) tracker.update(me.isAlive, me.score, Date.now());
        renderer.render(result, client.stateHash);
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
