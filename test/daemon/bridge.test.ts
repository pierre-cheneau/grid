import { strict as assert } from 'node:assert';
import { unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { DaemonBridge, type DaemonBridgeDeps } from '../../src/daemon/bridge.js';
import type { DaemonTransport } from '../../src/daemon/transport.js';
import type { Turn } from '../../src/sim/types.js';

// ---- Mock transport that lets tests control responses ----

class MockTransport implements DaemonTransport {
  readonly sent: string[] = [];
  private lineCallback: ((line: string) => void) | null = null;
  private exitCallback: ((code: number | null, error?: string) => void) | null = null;
  killed = false;

  send(line: string): void {
    this.sent.push(line);
  }

  onLine(cb: (line: string) => void): void {
    this.lineCallback = cb;
  }

  onExit(cb: (code: number | null, error?: string) => void): void {
    this.exitCallback = cb;
  }

  kill(): void {
    this.killed = true;
  }

  // Test helpers
  simulateLine(line: string): void {
    this.lineCallback?.(line);
  }

  simulateExit(code: number | null): void {
    this.exitCallback?.(code);
  }
}

// ---- Test fixture helpers ----

const SMALL_SOURCE = '// test daemon\nconsole.log("hello");';
const OVERSIZED_SOURCE = 'x'.repeat(5000);

function makeDeps(transport: MockTransport): {
  deps: DaemonBridgeDeps;
  inputs: Array<{ from: string; tick: number; i: Turn }>;
  broadcasts: Array<{ from: string; tick: number; i: Turn }>;
  peers: Set<string>;
  joins: Array<{ id: string; colorSeed: number }>;
} {
  const inputs: Array<{ from: string; tick: number; i: Turn }> = [];
  const broadcasts: Array<{ from: string; tick: number; i: Turn }> = [];
  const peers = new Set<string>();
  const joins: Array<{ id: string; colorSeed: number }> = [];
  return {
    deps: {
      broadcastInput: (daemonId, tick, turn) => broadcasts.push({ from: daemonId, tick, i: turn }),
      addPeer: (id) => peers.add(id),
      removePeer: (id) => peers.delete(id),
      queueJoin: (req) => joins.push(req),
      recordInput: (msg) => inputs.push({ from: msg.from, tick: msg.tick, i: msg.i }),
      createTransport: () => transport,
    },
    inputs,
    broadcasts,
    peers,
    joins,
  };
}

function makeState(tick: number) {
  return {
    tick,
    config: { width: 80, height: 40, halfLifeTicks: 100, seed: 0n, circular: false },
    rng: { state: 0n },
    players: new Map(),
    cells: new Map(),
  };
}

describe('DaemonBridge', () => {
  // Write temp files for source validation tests.
  const smallFile = join(tmpdir(), `grid-bridge-small-${Date.now()}.js`);
  const bigFile = join(tmpdir(), `grid-bridge-big-${Date.now()}.js`);
  writeFileSync(smallFile, SMALL_SOURCE);
  writeFileSync(bigFile, OVERSIZED_SOURCE);
  after(() => {
    try {
      unlinkSync(smallFile);
    } catch {
      /* */
    }
    try {
      unlinkSync(bigFile);
    } catch {
      /* */
    }
  });

  it('performs handshake and adds peer', async () => {
    const transport = new MockTransport();
    const { deps, peers, joins } = makeDeps(transport);
    const bridge = new DaemonBridge(
      {
        scriptPath: smallFile,
        daemonId: 'bot.test@user.host',
        colorSeed: 42,
        gridWidth: 80,
        gridHeight: 40,
      },
      deps,
    );

    const startPromise = bridge.start();

    // Wait for HELLO to be sent, then respond with HELLO_ACK.
    await new Promise((r) => setTimeout(r, 10));
    assert.ok(transport.sent.length > 0);
    // biome-ignore lint/style/noNonNullAssertion: test — sent[0] guaranteed by assert above
    const hello = JSON.parse(transport.sent[0]!);
    assert.equal(hello.t, 'HELLO');
    assert.equal(hello.you, 'bot.test@user.host');

    transport.simulateLine(
      JSON.stringify({ t: 'HELLO_ACK', v: 1, name: 'test', author: 'me', version: '0.1' }),
    );

    const ack = await startPromise;
    assert.equal(ack.name, 'test');
    assert.ok(bridge.isRunning);
    assert.ok(peers.has('bot.test@user.host'));
    assert.equal(joins.length, 1);
    assert.equal(joins[0]?.id, 'bot.test@user.host');
    assert.equal(joins[0]?.colorSeed, 42);

    bridge.stop();
  });

  it('rejects oversized source', async () => {
    const transport = new MockTransport();
    const { deps } = makeDeps(transport);
    const bridge = new DaemonBridge(
      {
        scriptPath: bigFile,
        daemonId: 'bot.big@user.host',
        colorSeed: 0,
        gridWidth: 80,
        gridHeight: 40,
      },
      deps,
    );

    await assert.rejects(() => bridge.start(), /max is 4096/);
    assert.ok(!bridge.isRunning);
  });

  it('rejects on handshake timeout', async () => {
    const transport = new MockTransport();
    const { deps } = makeDeps(transport);
    const bridge = new DaemonBridge(
      {
        scriptPath: smallFile,
        daemonId: 'bot.slow@user.host',
        colorSeed: 0,
        gridWidth: 80,
        gridHeight: 40,
      },
      deps,
    );

    // Don't respond to HELLO — let it time out.
    await assert.rejects(() => bridge.start(), /timeout/);
    assert.ok(!bridge.isRunning);
  });

  it('sends TICK and receives CMD', async () => {
    const transport = new MockTransport();
    const { deps, inputs, broadcasts } = makeDeps(transport);
    const bridge = new DaemonBridge(
      {
        scriptPath: smallFile,
        daemonId: 'bot.test@user.host',
        colorSeed: 42,
        gridWidth: 80,
        gridHeight: 40,
      },
      deps,
    );

    const startPromise = bridge.start();
    await new Promise((r) => setTimeout(r, 10));
    transport.simulateLine(
      JSON.stringify({ t: 'HELLO_ACK', v: 1, name: 'test', author: 'me', version: '0.1' }),
    );
    await startPromise;

    // Send a tick.
    bridge.onTick(makeState(100));
    // biome-ignore lint/style/noNonNullAssertion: test — sent has entries after onTick
    const tickMsg = JSON.parse(transport.sent[transport.sent.length - 1]!);
    assert.equal(tickMsg.t, 'TICK');
    assert.equal(tickMsg.n, 100);

    // Simulate CMD response.
    transport.simulateLine(JSON.stringify({ t: 'CMD', n: 100, i: 'L' }));

    assert.equal(inputs.length, 1);
    assert.equal(inputs[0]?.from, 'bot.test@user.host');
    assert.equal(inputs[0]?.tick, 101); // CMD for tick 100 → input for tick 101
    assert.equal(inputs[0]?.i, 'L');
    assert.equal(broadcasts.length, 1);

    bridge.stop();
  });

  it('evicts after 10 consecutive errors', async () => {
    const transport = new MockTransport();
    const { deps, peers } = makeDeps(transport);
    const bridge = new DaemonBridge(
      {
        scriptPath: smallFile,
        daemonId: 'bot.bad@user.host',
        colorSeed: 0,
        gridWidth: 80,
        gridHeight: 40,
      },
      deps,
    );

    const startPromise = bridge.start();
    await new Promise((r) => setTimeout(r, 10));
    transport.simulateLine(
      JSON.stringify({ t: 'HELLO_ACK', v: 1, name: 'bad', author: 'me', version: '0.1' }),
    );
    await startPromise;

    // Send 10 bad responses.
    for (let i = 0; i < 10; i++) {
      bridge.onTick(makeState(i));
      transport.simulateLine('not json at all');
    }

    assert.ok(!bridge.isRunning);
    assert.ok(!peers.has('bot.bad@user.host'));
  });

  it('stop removes peer and kills transport', async () => {
    const transport = new MockTransport();
    const { deps, peers } = makeDeps(transport);
    const bridge = new DaemonBridge(
      {
        scriptPath: smallFile,
        daemonId: 'bot.test@user.host',
        colorSeed: 42,
        gridWidth: 80,
        gridHeight: 40,
      },
      deps,
    );

    const startPromise = bridge.start();
    await new Promise((r) => setTimeout(r, 10));
    transport.simulateLine(
      JSON.stringify({ t: 'HELLO_ACK', v: 1, name: 'test', author: 'me', version: '0.1' }),
    );
    await startPromise;

    bridge.stop();
    assert.ok(!bridge.isRunning);
    assert.ok(!peers.has('bot.test@user.host'));
    assert.ok(transport.killed);
  });

  it('handles transport exit gracefully', async () => {
    const transport = new MockTransport();
    const { deps, peers } = makeDeps(transport);
    const bridge = new DaemonBridge(
      {
        scriptPath: smallFile,
        daemonId: 'bot.test@user.host',
        colorSeed: 42,
        gridWidth: 80,
        gridHeight: 40,
      },
      deps,
    );

    const startPromise = bridge.start();
    await new Promise((r) => setTimeout(r, 10));
    transport.simulateLine(
      JSON.stringify({ t: 'HELLO_ACK', v: 1, name: 'test', author: 'me', version: '0.1' }),
    );
    await startPromise;

    // Simulate the transport exiting unexpectedly.
    transport.simulateExit(1);
    assert.ok(!bridge.isRunning);
    assert.ok(!peers.has('bot.test@user.host'));
  });

  it('consecutive errors reset on valid CMD', async () => {
    const transport = new MockTransport();
    const { deps } = makeDeps(transport);
    const bridge = new DaemonBridge(
      {
        scriptPath: smallFile,
        daemonId: 'bot.test@user.host',
        colorSeed: 0,
        gridWidth: 80,
        gridHeight: 40,
      },
      deps,
    );

    const startPromise = bridge.start();
    await new Promise((r) => setTimeout(r, 10));
    transport.simulateLine(
      JSON.stringify({ t: 'HELLO_ACK', v: 1, name: 'test', author: 'me', version: '0.1' }),
    );
    await startPromise;

    // 9 bad responses (just under the threshold).
    for (let i = 0; i < 9; i++) {
      bridge.onTick(makeState(i));
      transport.simulateLine('garbage');
    }
    assert.ok(bridge.isRunning);

    // One valid response resets the counter.
    bridge.onTick(makeState(9));
    transport.simulateLine(JSON.stringify({ t: 'CMD', n: 9, i: '' }));
    assert.ok(bridge.isRunning);

    // 9 more bad responses — still alive because counter was reset.
    for (let i = 10; i < 19; i++) {
      bridge.onTick(makeState(i));
      transport.simulateLine('garbage');
    }
    assert.ok(bridge.isRunning);

    bridge.stop();
  });
});
