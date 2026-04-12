// DaemonBridge — lifecycle manager for a daemon process.
//
// Validates source size, launches the transport, performs handshake, extracts
// per-tick state and sends TICK messages, receives CMD responses and injects
// them into lockstep. Evicts the daemon after too many consecutive errors.

import { readFileSync } from 'node:fs';
import type { GridState, PlayerId, Turn } from '../sim/types.js';
import {
  DAEMON_HANDSHAKE_TIMEOUT_MS,
  DAEMON_MAX_CONSECUTIVE_ERRORS,
  DAEMON_MAX_SOURCE_BYTES,
} from './constants.js';
import { extractDaemonTick } from './state-extractor.js';
import type { DaemonTransport } from './transport.js';
import type { DaemonHelloAck } from './types.js';
import { parseCmd, parseHelloAck } from './validate.js';

export interface DaemonBridgeConfig {
  readonly scriptPath: string;
  readonly daemonId: PlayerId;
  readonly colorSeed: number;
  readonly gridWidth: number;
  readonly gridHeight: number;
}

export interface DaemonBridgeDeps {
  readonly broadcastInput: (daemonId: string, tick: number, turn: Turn) => void;
  readonly addPeer: (id: PlayerId) => void;
  readonly removePeer: (id: PlayerId) => void;
  readonly queueJoin: (req: { id: PlayerId; colorSeed: number }) => void;
  readonly recordInput: (msg: { v: 1; t: 'INPUT'; from: string; tick: number; i: Turn }) => void;
  readonly createTransport: (scriptPath: string) => DaemonTransport;
}

export class DaemonBridge {
  private readonly config: DaemonBridgeConfig;
  private readonly deps: DaemonBridgeDeps;
  private transport: DaemonTransport | null = null;
  private running = false;
  private consecutiveErrors = 0;
  private lastTickSent = -1;

  constructor(config: DaemonBridgeConfig, deps: DaemonBridgeDeps) {
    this.config = config;
    this.deps = deps;
  }

  get isRunning(): boolean {
    return this.running;
  }

  get daemonId(): PlayerId {
    return this.config.daemonId;
  }

  get colorSeed(): number {
    return this.config.colorSeed;
  }

  /** Validate source size, launch transport, perform handshake. */
  async start(): Promise<DaemonHelloAck> {
    // Validate source size.
    const source = readFileSync(this.config.scriptPath, 'utf-8').replace(/\r\n/g, '\n');
    const byteCount = Buffer.byteLength(source, 'utf-8');
    if (byteCount > DAEMON_MAX_SOURCE_BYTES) {
      throw new Error(
        `daemon is ${byteCount} bytes, max is ${DAEMON_MAX_SOURCE_BYTES} — try removing comments or simplifying logic`,
      );
    }

    // Launch transport.
    this.transport = this.deps.createTransport(this.config.scriptPath);
    this.running = true;

    // Wire up exit handler.
    this.transport.onExit((_code, _error) => {
      if (this.running) {
        this.running = false;
        this.deps.removePeer(this.config.daemonId);
      }
    });

    // Wire up line handler for CMD responses.
    this.transport.onLine((line) => this.handleLine(line));

    // Perform handshake.
    const ack = await this.handshake();
    this.deps.addPeer(this.config.daemonId);
    this.deps.queueJoin({ id: this.config.daemonId, colorSeed: this.config.colorSeed });
    return ack;
  }

  /** Called after each tick advance. Sends TICK to the daemon. */
  onTick(state: GridState): void {
    if (!this.running || this.transport === null) return;
    const tick = extractDaemonTick(state, this.config.daemonId);
    this.lastTickSent = tick.n;
    this.transport.send(JSON.stringify(tick));
  }

  /** Gracefully stop the daemon. */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.transport?.kill();
    this.transport = null;
    this.deps.removePeer(this.config.daemonId);
  }

  // ---- internal ----

  private async handshake(): Promise<DaemonHelloAck> {
    // Narrow the transport type for the closure below. Cannot be null here
    // (called immediately after assignment in start()), but TypeScript needs it.
    const transport = this.transport;
    if (transport === null) throw new Error('transport not initialized');
    return new Promise<DaemonHelloAck>((resolve, reject) => {
      const hello = {
        t: 'HELLO' as const,
        v: 1 as const,
        you: this.config.daemonId,
        tick_ms: 100,
        config: { grid_w: this.config.gridWidth, grid_h: this.config.gridHeight },
      };

      const timer = setTimeout(() => {
        reject(new Error('daemon handshake timeout'));
        this.stop();
      }, DAEMON_HANDSHAKE_TIMEOUT_MS);

      // Temporarily replace the line handler for the handshake phase.
      // Skip non-HELLO_ACK lines (daemon debug output, shebang echoes, etc.)
      // until the handshake arrives or the timeout fires.
      const prevHandler = this.handleLine.bind(this);
      transport.onLine((line) => {
        const ack = parseHelloAck(line);
        if (ack !== null) {
          clearTimeout(timer);
          transport.onLine((l) => prevHandler(l));
          resolve(ack);
        }
        // Ignore non-HELLO_ACK lines during handshake; let timeout handle failure.
      });

      transport.send(JSON.stringify(hello));
    });
  }

  private handleLine(line: string): void {
    if (!this.running || this.lastTickSent < 0) return;

    const cmd = parseCmd(line, this.lastTickSent);
    if (cmd === null) {
      this.recordError();
      return;
    }

    this.consecutiveErrors = 0;
    // Inject the daemon's turn into lockstep for the NEXT tick.
    const nextTick = cmd.n + 1;
    this.deps.recordInput({
      v: 1,
      t: 'INPUT',
      from: this.config.daemonId,
      tick: nextTick,
      i: cmd.i,
    });
    this.deps.broadcastInput(this.config.daemonId, nextTick, cmd.i);
  }

  private recordError(): void {
    this.consecutiveErrors++;
    if (this.consecutiveErrors >= DAEMON_MAX_CONSECUTIVE_ERRORS) {
      this.stop();
    }
  }
}
