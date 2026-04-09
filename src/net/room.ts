// Trystero adapter. The ONLY file in the entire codebase that imports from `trystero`.
// All higher layers (NetClient, lockstep, sync, etc.) talk to the `Room` interface.
// Tests inject a MockRoom that implements the same interface without any real WebRTC.

import { CHANNEL_CTRL, CHANNEL_TICK, REJOIN_INTERVAL_MS } from './constants.js';
import { dbg } from './debug.js';

export interface Room {
  onPeerJoin(cb: (peerId: string) => void): void;
  onPeerLeave(cb: (peerId: string) => void): void;
  onCtrl(cb: (raw: string, peerId: string) => void): void;
  onTick(cb: (raw: string, peerId: string) => void): void;
  sendCtrl(raw: string, to?: string): void;
  sendTick(raw: string): void;
  leave(): Promise<void>;
}

export interface RoomFactoryOpts {
  readonly relayUrls?: ReadonlyArray<string> | undefined;
}

export type RoomFactory = (
  roomKey: string,
  localPeerId: string,
  opts?: RoomFactoryOpts,
) => Promise<Room>;

// Default relay list. Each relay must: (1) accept WebSocket connections, (2) accept
// Trystero's custom event kind 22766, (3) not require paid signup or web-of-trust,
// (4) not aggressively rate-limit. See docs/architecture/networking.md.
const DEFAULT_RELAYS = [
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://relay.notoshi.win',
  'wss://relay.mostr.pub',
  'wss://relay.nostr.net',
];

type Listener = (raw: string, peerId: string) => void;
type PeerCb = (peerId: string) => void;

/**
 * Wraps a Trystero room with automatic rejoin-on-no-peers. Owns the lifecycle
 * of the underlying room instance, the data channel actions, and the listener
 * registrations. Clean up via `leave()`.
 */
class ResilientRoom implements Room {
  private trysteroRoom: ReturnType<typeof import('trystero/nostr').joinRoom>;
  private ctrl: { send: (raw: string, to?: string) => void };
  private tick: { send: (raw: string) => void };
  private peerCount = 0;
  private leaving = false;
  private rejoinTimer: ReturnType<typeof setInterval>;

  private readonly joinCbs: PeerCb[] = [];
  private readonly leaveCbs: PeerCb[] = [];
  private readonly ctrlCbs: Listener[] = [];
  private readonly tickCbs: Listener[] = [];

  constructor(
    // biome-ignore lint/suspicious/noExplicitAny: Trystero's joinRoom return type
    private readonly joinFn: (...args: any[]) => any,
    // biome-ignore lint/suspicious/noExplicitAny: Trystero room config
    private readonly roomConfig: any,
    private readonly roomKey: string,
  ) {
    this.trysteroRoom = this.joinFn(this.roomConfig, this.roomKey);
    const actions = this.negotiateChannels();
    this.ctrl = actions.ctrl;
    this.tick = actions.tick;
    this.attachListeners();
    dbg('room: joinRoom returned; channels ctrl/tick negotiated');

    this.rejoinTimer = setInterval(() => this.maybeRejoin(), REJOIN_INTERVAL_MS);
  }

  onPeerJoin(cb: PeerCb): void {
    this.joinCbs.push(cb);
  }

  onPeerLeave(cb: PeerCb): void {
    this.leaveCbs.push(cb);
  }

  onCtrl(cb: Listener): void {
    this.ctrlCbs.push(cb);
  }

  onTick(cb: Listener): void {
    this.tickCbs.push(cb);
  }

  sendCtrl(raw: string, to?: string): void {
    dbg(`room: ctrl send ${to ?? 'broadcast'}: ${raw.slice(0, 100)}`);
    if (to !== undefined) this.ctrl.send(raw, to);
    else this.ctrl.send(raw);
  }

  sendTick(raw: string): void {
    dbg(`room: tick send: ${raw.slice(0, 100)}`);
    this.tick.send(raw);
  }

  async leave(): Promise<void> {
    this.leaving = true;
    clearInterval(this.rejoinTimer);
    dbg('room: leaving');
    await this.trysteroRoom.leave();
  }

  // ---- Internal ----

  private negotiateChannels() {
    const [sCtrl, rCtrl] = this.trysteroRoom.makeAction<string>(CHANNEL_CTRL);
    const [sTick, rTick] = this.trysteroRoom.makeAction<string>(CHANNEL_TICK);
    rCtrl((data: string, peerId: string) => {
      dbg(`room: ctrl recv from ${peerId}: ${String(data).slice(0, 100)}`);
      for (const cb of this.ctrlCbs) cb(String(data), peerId);
    });
    rTick((data: string, peerId: string) => {
      dbg(`room: tick recv from ${peerId}: ${String(data).slice(0, 100)}`);
      for (const cb of this.tickCbs) cb(String(data), peerId);
    });
    return {
      ctrl: { send: sCtrl as (raw: string, to?: string) => void },
      tick: { send: sTick as (raw: string) => void },
    };
  }

  private attachListeners(): void {
    this.trysteroRoom.onPeerJoin((peerId: string) => {
      dbg(`room: trystero onPeerJoin ${peerId}`);
      this.peerCount++;
      clearInterval(this.rejoinTimer);
      for (const cb of this.joinCbs) cb(peerId);
    });
    this.trysteroRoom.onPeerLeave((peerId: string) => {
      dbg(`room: trystero onPeerLeave ${peerId}`);
      this.peerCount = Math.max(0, this.peerCount - 1);
      for (const cb of this.leaveCbs) cb(peerId);
    });
  }

  private maybeRejoin(): void {
    if (this.leaving || this.peerCount > 0) return;
    dbg('room: no peers connected — rejoining to re-publish presence');
    this.trysteroRoom
      .leave()
      .then(() => {
        if (this.leaving) return;
        this.trysteroRoom = this.joinFn(this.roomConfig, this.roomKey);
        const actions = this.negotiateChannels();
        this.ctrl = actions.ctrl;
        this.tick = actions.tick;
        this.attachListeners();
        dbg('room: rejoined; channels re-negotiated');
      })
      .catch((err: unknown) => {
        dbg(`room: rejoin failed: ${String(err)}`);
      });
  }
}

/**
 * Default factory: opens a real Trystero/Nostr room with automatic rejoin.
 * Imported lazily so test code that injects a MockRoom doesn't pay the load cost.
 */
export const createTrysteroRoom: RoomFactory = async (roomKey, localPeerId, opts) => {
  dbg(`room: opening trystero/nostr room "${roomKey}" as ${localPeerId}`);
  const { joinRoom, selfId } = await import('trystero/nostr');
  dbg(`room: trystero loaded; selfId=${String(selfId)}`);
  const polyfillNs = (await import('node-datachannel/polyfill')) as unknown as {
    RTCPeerConnection?: unknown;
    default?: { RTCPeerConnection?: unknown };
  };
  const polyfillCtor = polyfillNs.RTCPeerConnection ?? polyfillNs.default?.RTCPeerConnection;
  if (polyfillCtor === undefined) {
    throw new Error('node-datachannel polyfill missing RTCPeerConnection');
  }
  dbg('room: node-datachannel polyfill loaded');
  void selfId;
  const relayUrls = opts?.relayUrls?.length ? [...opts.relayUrls] : DEFAULT_RELAYS;
  // biome-ignore lint/suspicious/noExplicitAny: trystero accepts the polyfill ctor
  const roomConfig = { appId: 'grid', rtcPolyfill: polyfillCtor as any, relayUrls };
  return new ResilientRoom(joinRoom, roomConfig, roomKey);
};
