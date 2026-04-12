// Sandbox test runner for forged daemons.
//
// Runs a daemon against a headless simulation for 600 ticks (60 seconds).
// Verifies: handshake completes, daemon responds to ticks, daemon survives
// at least 50 ticks (5 seconds), source is under 4096 bytes.
// No networking, no rendering — pure local simulation.

import { readFileSync } from 'node:fs';
import { newRng, simulateTick } from '../../sim/index.js';
import type { Turn } from '../../sim/types.js';
import type { GridState, Inputs, PlayerId } from '../../sim/types.js';
import { DaemonBridge } from '../bridge.js';
import { DAEMON_MAX_SOURCE_BYTES } from '../constants.js';
import { createSubprocessTransport } from '../subprocess-transport.js';
import type { DaemonTransport } from '../transport.js';

export interface SandboxResult {
  readonly passed: boolean;
  readonly ticks: number;
  readonly error?: string;
  readonly byteCount: number;
  readonly survivalTicks: number;
}

const SANDBOX_TICKS = 200;
const MIN_SURVIVAL_TICKS = 30;
const SANDBOX_SEED = 0xdead_beefn;

function makeInitialState(daemonId: PlayerId): GridState {
  const config = {
    width: 250,
    height: 250,
    halfLifeTicks: 200,
    seed: SANDBOX_SEED,
    circular: false,
  };
  const rng = newRng(SANDBOX_SEED);
  const players = new Map([
    [
      daemonId,
      {
        id: daemonId,
        pos: { x: 50, y: 125 },
        dir: 1 as const,
        isAlive: true,
        respawnAtTick: null,
        score: 0,
        colorSeed: 0,
      },
    ],
    [
      'stub-a@sandbox',
      {
        id: 'stub-a@sandbox',
        pos: { x: 200, y: 125 },
        dir: 3 as const,
        isAlive: true,
        respawnAtTick: null,
        score: 0,
        colorSeed: 1,
      },
    ],
    [
      'stub-b@sandbox',
      {
        id: 'stub-b@sandbox',
        pos: { x: 125, y: 50 },
        dir: 2 as const,
        isAlive: true,
        respawnAtTick: null,
        score: 0,
        colorSeed: 2,
      },
    ],
  ]);
  return { tick: 0, config, rng, players, cells: new Map() };
}

export async function runSandbox(scriptPath: string): Promise<SandboxResult> {
  // Check source size.
  const source = readFileSync(scriptPath, 'utf-8').replace(/\r\n/g, '\n');
  const byteCount = Buffer.byteLength(source, 'utf-8');
  if (byteCount > DAEMON_MAX_SOURCE_BYTES) {
    return {
      passed: false,
      ticks: 0,
      error: `daemon is ${byteCount} bytes, max is ${DAEMON_MAX_SOURCE_BYTES}`,
      byteCount,
      survivalTicks: 0,
    };
  }

  const daemonId = 'bot.sandbox@test.host';
  let state = makeInitialState(daemonId);
  let daemonTurn: Turn = '';
  let handshakeDone = false;
  let survivalTicks = 0;
  let ticksRun = 0;
  let error: string | undefined;

  // Create a bridge with deps that capture daemon turns.
  const deps = {
    broadcastInput: () => {},
    addPeer: () => {},
    removePeer: () => {},
    queueJoin: () => {},
    recordInput: (msg: { i: Turn }) => {
      daemonTurn = msg.i;
    },
    createTransport: (path: string): DaemonTransport => createSubprocessTransport(path),
  };

  const bridge = new DaemonBridge(
    { scriptPath, daemonId, colorSeed: 0, gridWidth: 250, gridHeight: 250 },
    deps,
  );

  try {
    await bridge.start();
    handshakeDone = true;
  } catch (err) {
    return {
      passed: false,
      ticks: 0,
      error: `handshake failed: ${err instanceof Error ? err.message : String(err)}`,
      byteCount,
      survivalTicks: 0,
    };
  }

  try {
    for (let i = 0; i < SANDBOX_TICKS; i++) {
      if (!bridge.isRunning) {
        error = `daemon exited at tick ${i}`;
        break;
      }

      // Build inputs: daemon turn + stub bots go straight.
      const turns = new Map<PlayerId, Turn>();
      turns.set(daemonId, daemonTurn);
      turns.set('stub-a@sandbox', '');
      turns.set('stub-b@sandbox', '');
      daemonTurn = ''; // Reset for next tick.

      const inputs: Inputs = { turns, joins: [] };
      state = simulateTick(state, inputs);
      ticksRun++;

      // Track survival.
      const me = state.players.get(daemonId);
      if (me?.isAlive) survivalTicks++;

      // Send the new state to the daemon.
      bridge.onTick(state);

      // Give the daemon a moment to respond. Windows setTimeout has ~15ms
      // minimum resolution, so 8ms is effectively ~15ms per tick.
      await new Promise((r) => setTimeout(r, 8));
    }
  } catch (err) {
    error = `runtime error: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    bridge.stop();
  }

  const passed = handshakeDone && survivalTicks >= MIN_SURVIVAL_TICKS && error === undefined;
  return {
    passed,
    ticks: ticksRun,
    byteCount,
    survivalTicks,
    ...(error !== undefined ? { error } : {}),
  };
}
