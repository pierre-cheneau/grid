#!/usr/bin/env node
// GRID — Stage 3 CLI driver. Wires NetClient + AnsiWriter into one process.
//
// Layout responsibilities split into helpers so `main()` stays small:
//   parseArgs           — argv → CliConfig
//   makeInitialState    — CliConfig + identity → GridState
//   setupRenderer       — choose AnsiWriter (TTY) or status-line fallback (piped)
//   setupShutdown       — return the idempotent shutdown closure
//   setupKeyboard       — raw stdin → NetClient.setLocalInput
//   main                — wire everything and start the 10 fps tick loop
//
// Top-level error discipline (errors-and-boundaries.md §220-237):
//   - main() is wrapped in .catch() that calls cleanupTerminal() before exiting
//   - process.on('uncaughtException' | 'unhandledRejection') handlers also clean up
// Quadruple coverage means a stuck alt-screen is impossible barring a SIGKILL.

import { argv, exit, stdin, stdout } from 'node:process';
import { deriveLocalId } from '../id/identity.js';
import { TICK_DURATION_MS } from '../net/constants.js';
import { NetClient } from '../net/index.js';
import { createTrysteroRoom } from '../net/room.js';
import { AnsiWriter, type Viewport, buildFrame, cleanupTerminal } from '../render/index.js';
import { type Config, type GridState, TICKS_PER_SECOND, hashState, newRng } from '../sim/index.js';

interface CliConfig {
  readonly room: string;
  readonly width: number;
  readonly height: number;
  readonly seed: bigint;
  readonly halfLifeTicks: number;
}

interface RendererHandle {
  render(state: GridState): void;
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
  const today = new Date().toISOString().slice(0, 10);
  return {
    room: opts['room'] ?? `grid:${today}`,
    width: opts['width'] ? Number.parseInt(opts['width'], 10) : 32,
    height: opts['height'] ? Number.parseInt(opts['height'], 10) : 32,
    seed: opts['seed'] ? BigInt(opts['seed']) : 0xc0ffee_deadbeefn,
    halfLifeTicks: opts['half-life-ticks'] ? Number.parseInt(opts['half-life-ticks'], 10) : 600,
  };
}

function makeInitialState(cfg: CliConfig, localId: string, colorSeed: number): GridState {
  const config: Config = {
    width: cfg.width,
    height: cfg.height,
    halfLifeTicks: cfg.halfLifeTicks,
    seed: cfg.seed,
  };
  const x = Math.abs(colorSeed) % cfg.width;
  const y = Math.abs(colorSeed >> 8) % cfg.height;
  return {
    tick: 0,
    config,
    rng: newRng(cfg.seed),
    players: new Map([
      [
        localId,
        {
          id: localId,
          pos: { x, y },
          dir: 1,
          isAlive: true,
          respawnAtTick: null,
          score: 0,
          colorSeed,
        },
      ],
    ]),
    cells: new Map(),
  };
}

function buildStatusLine(state: GridState, localId: string): string {
  const me = state.players.get(localId);
  const tick = state.tick.toString().padStart(4, '0');
  const pos = me ? `(${me.pos.x},${me.pos.y})` : '(--)';
  const dir = me ? me.dir : '?';
  const alive = me?.isAlive ? 'Y' : 'N';
  const score = me?.score ?? 0;
  const peers = state.players.size;
  const hash = hashState(state);
  return `[t=${tick}] me=${pos} dir=${dir} peers=${peers} alive=${alive} score=${score} hash=${hash}`;
}

function setupRenderer(localId: string): RendererHandle {
  // TTY fallback: piped output gets the Stage 5 status-line behavior, no escapes.
  if (!stdout.isTTY) {
    let lastPrinted = 0;
    return {
      render(state) {
        if (state.tick - lastPrinted < TICKS_PER_SECOND) return;
        lastPrinted = state.tick;
        stdout.write(`${buildStatusLine(state, localId)}\n`);
      },
      shutdown() {
        /* nothing to clean up */
      },
    };
  }
  // Real TTY: alt-screen + buildFrame at 10 fps.
  const writer = new AnsiWriter({ stdout });
  writer.begin();
  let viewport: Viewport = { cols: stdout.columns ?? 80, rows: stdout.rows ?? 24 };
  stdout.on('resize', () => {
    viewport = { cols: stdout.columns ?? 80, rows: stdout.rows ?? 24 };
  });
  return {
    render(state) {
      writer.endFrame(buildFrame(state, viewport, localId));
    },
    shutdown() {
      writer.shutdown();
    },
  };
}

function setupShutdown(client: NetClient, renderer: RendererHandle): () => Promise<void> {
  let stopping = false;
  return async () => {
    if (stopping) return;
    stopping = true;
    renderer.shutdown();
    stdout.write(`\ngrid: bye. final hash = ${hashState(client.currentState)}\n`);
    await client.stop();
    exit(0);
  };
}

function setupKeyboard(client: NetClient, shutdown: () => Promise<void>): void {
  if (stdin.isTTY) stdin.setRawMode(true);
  stdin.resume();
  stdin.on('data', (chunk) => {
    const s = chunk.toString();
    if (s === 'q' || s === '\x03' /* Ctrl-C */ || s === '\x1b' /* ESC */) {
      void shutdown();
      return;
    }
    if (s === '\x1b[D') client.setLocalInput('L');
    else if (s === '\x1b[C') client.setLocalInput('R');
  });
}

async function main(): Promise<void> {
  const cfg = parseArgs(argv.slice(2));
  const id = deriveLocalId();
  const client = new NetClient(
    {
      roomKey: cfg.room,
      identity: id,
      initialState: makeInitialState(cfg, id.id, id.colorSeed),
    },
    { roomFactory: createTrysteroRoom, clock: Date.now },
  );
  await client.start();
  const renderer = setupRenderer(id.id);
  const shutdown = setupShutdown(client, renderer);
  setupKeyboard(client, shutdown);
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
  setInterval(
    () => {
      const result = client.runOnce(Date.now());
      if (result !== null) renderer.render(result);
    },
    Math.floor(TICK_DURATION_MS / 2),
  );
}

// Quadruple terminal-cleanup safety net.
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
