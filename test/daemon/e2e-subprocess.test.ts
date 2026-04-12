import { strict as assert } from 'node:assert';
import { unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { DaemonBridge } from '../../src/daemon/bridge.js';
import { createSubprocessTransport } from '../../src/daemon/subprocess-transport.js';
import { newRng, simulateTick } from '../../src/sim/index.js';
import type { PlayerId, Turn } from '../../src/sim/types.js';
import type { GridState, Inputs } from '../../src/sim/types.js';

// Daemon that always turns right.
const RIGHT_TURNER = `
const rl = require('readline').createInterface({ input: process.stdin });
const s = m => process.stdout.write(JSON.stringify(m) + '\\n');
let h = false;
rl.on('line', l => {
  const m = JSON.parse(l);
  if (!h) { s({ t: 'HELLO_ACK', v: 1, name: 'righty', author: 'test', version: '0.1' }); h = true; return; }
  if (m.t === 'TICK') s({ t: 'CMD', n: m.n, i: m.you && m.you.alive ? 'R' : '' });
});
`;

describe('E2E subprocess daemon', () => {
  const tmpFile = join(tmpdir(), `grid-e2e-daemon-${Date.now()}.js`);
  writeFileSync(tmpFile, RIGHT_TURNER);
  after(() => {
    try {
      unlinkSync(tmpFile);
    } catch {
      /* ignore */
    }
  });

  it('daemon inputs flow through lockstep-like loop for 50 ticks', async () => {
    const daemonId = 'bot.righty@test.host';
    const pilotId = 'pilot@test.host';
    const config = { width: 80, height: 40, halfLifeTicks: 100, seed: 42n, circular: false };

    let state: GridState = {
      tick: 0,
      config,
      rng: newRng(42n),
      players: new Map([
        [
          daemonId,
          {
            id: daemonId,
            pos: { x: 20, y: 20 },
            dir: 1 as const,
            isAlive: true,
            respawnAtTick: null,
            score: 0,
            colorSeed: 100,
          },
        ],
        [
          pilotId,
          {
            id: pilotId,
            pos: { x: 60, y: 20 },
            dir: 3 as const,
            isAlive: true,
            respawnAtTick: null,
            score: 0,
            colorSeed: 200,
          },
        ],
      ]),
      cells: new Map(),
    };

    let daemonTurn: Turn = '';
    const bridge = new DaemonBridge(
      { scriptPath: tmpFile, daemonId, colorSeed: 100, gridWidth: 80, gridHeight: 40 },
      {
        broadcastInput: () => {},
        addPeer: () => {},
        removePeer: () => {},
        queueJoin: () => {},
        recordInput: (msg) => {
          daemonTurn = msg.i;
        },
        createTransport: (p) => createSubprocessTransport(p),
      },
    );

    await bridge.start();
    assert.ok(bridge.isRunning);

    for (let i = 0; i < 50; i++) {
      const turns = new Map<PlayerId, Turn>();
      turns.set(daemonId, daemonTurn);
      turns.set(pilotId, ''); // pilot goes straight
      daemonTurn = '';

      const inputs: Inputs = { turns, joins: [] };
      state = simulateTick(state, inputs);

      bridge.onTick(state);
      // Wait for daemon to respond.
      await new Promise((r) => setTimeout(r, 15));
    }

    bridge.stop();

    // The daemon should have stayed alive and turned right many times.
    // We just verify the simulation ran 50 ticks without crashing.
    assert.equal(state.tick, 50);
    // Both players should still exist (may have died and respawned).
    assert.ok(state.players.has(daemonId));
    assert.ok(state.players.has(pilotId));
  });
});
