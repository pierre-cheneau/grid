#!/usr/bin/env node
// GRID — minimal Stage 2 CLI driver.
//
// Argv parsing → identity → NetClient → raw stdin keyboard → status line every second.
// No renderer. No box-drawing. The status line is the visualization.

import { argv, exit, stdin, stdout } from 'node:process';
import { deriveLocalId } from '../id/identity.js';
import { TICK_DURATION_MS } from '../net/constants.js';
import { NetClient } from '../net/index.js';
import { createTrysteroRoom } from '../net/room.js';
import { type Config, type GridState, hashState, newRng } from '../sim/index.js';
import { TICKS_PER_SECOND } from '../sim/index.js';

interface CliConfig {
  readonly room: string;
  readonly width: number;
  readonly height: number;
  readonly seed: bigint;
  readonly halfLifeTicks: number;
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
  // Spawn the local player at a deterministic position derived from id hash so two
  // peers in the same room with different ids start in different cells.
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

async function main(): Promise<void> {
  const cfg = parseArgs(argv.slice(2));
  const id = deriveLocalId();
  stdout.write(`grid: ${id.id} joining ${cfg.room}\n`);

  const client = new NetClient(
    {
      roomKey: cfg.room,
      identity: id,
      initialState: makeInitialState(cfg, id.id, id.colorSeed),
    },
    {
      roomFactory: createTrysteroRoom,
      clock: Date.now,
    },
  );

  client.on('peerJoin', (peerId) => stdout.write(`> peer joined: ${peerId}\n`));
  client.on('peerLeave', (peerId) => stdout.write(`< peer left:   ${peerId}\n`));
  client.on('evict', (peerId, reason) => stdout.write(`! evicted ${peerId} (${reason})\n`));

  await client.start();

  // Raw stdin for arrow keys + q.
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

  let stopping = false;
  const shutdown = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    stdout.write(`\ngrid: bye. final hash = ${hashState(client.currentState)}\n`);
    await client.stop();
    exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  // Drive the lockstep at 10 Hz. Print a status line every TICKS_PER_SECOND ticks.
  let lastPrintedTick = 0;
  const interval = setInterval(
    () => {
      if (stopping) return;
      const result = client.runOnce(Date.now());
      if (result === null) return;
      if (result.tick - lastPrintedTick >= TICKS_PER_SECOND) {
        lastPrintedTick = result.tick;
        const me = result.players.get(id.id);
        const peerCount = result.players.size;
        const h = hashState(result);
        const pos = me ? `(${me.pos.x},${me.pos.y})` : '(--)';
        const dir = me ? me.dir : '?';
        const alive = me?.isAlive ? 'Y' : 'N';
        const score = me?.score ?? 0;
        stdout.write(
          `[t=${result.tick.toString().padStart(4, '0')}] me=${pos} dir=${dir} peers=${peerCount} alive=${alive} score=${score} hash=${h}\n`,
        );
      }
    },
    Math.floor(TICK_DURATION_MS / 2),
  );
  // Reference the interval so the process keeps running.
  void interval;
}

main().catch((err: unknown) => {
  process.stderr.write(`grid: fatal: ${String(err)}\n`);
  exit(1);
});
