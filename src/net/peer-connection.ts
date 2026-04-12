// Single WebRTC peer connection with two data channels (ctrl + tick).
//
// Wraps the W3C-compatible RTCPeerConnection from `node-datachannel/polyfill`.
// SDP/ICE signaling is delegated to a caller-supplied `sendSignaling` callback
// (wired to Nostr in NostrRoom). Both data channels must be open before
// `onOpen` fires; messages sent before open are buffered (bounded) and flushed
// on open.

import { CHANNEL_CTRL, CHANNEL_TICK } from './constants.js';
import { dbg } from './debug.js';
import type { SignalingMessage } from './nostr-signaling.js';

// The node-datachannel polyfill implements W3C RTCPeerConnection, but its
// types diverge from lib.dom RTCPeerConnection in small ways (extensions,
// event payload shapes). We use `any` at the boundary and rely on the
// W3C-shaped call sites below for correctness.
// biome-ignore lint/suspicious/noExplicitAny: node-datachannel polyfill types
type PC = any;
// biome-ignore lint/suspicious/noExplicitAny: polyfill DataChannel type
type DC = any;

const RTC_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] } as const;

/** Upper bound on the send buffers before data channels open. Unreliable tick
 *  traffic is dropped oldest-first once full; reliable ctrl traffic drops newest
 *  with a debug log (should never happen in practice). */
const MAX_CTRL_BUFFER = 64;
const MAX_TICK_BUFFER = 128;

type ChannelLabel = typeof CHANNEL_CTRL | typeof CHANNEL_TICK;

export interface PeerConnectionDeps {
  readonly remotePubkey: string;
  readonly isInitiator: boolean;
  readonly sendSignaling: (msg: SignalingMessage) => void;
  readonly onCtrlMessage: (raw: string) => void;
  readonly onTickMessage: (raw: string) => void;
  readonly onOpen: () => void;
  readonly onClose: () => void;
}

export class PeerConnection {
  private readonly deps: PeerConnectionDeps;
  private pc: PC | null = null;
  private ctrlChannel: DC | null = null;
  private tickChannel: DC | null = null;
  private ctrlBuffer: string[] = [];
  private tickBuffer: string[] = [];
  private opened = false;
  private closed = false;
  /** Promise chain that serializes signaling message processing and waits for
   *  init() to complete. Without this, a burst of events delivered out-of-order
   *  by Nostr relays (offer + ICE candidates published within milliseconds) can
   *  race each other: ICE handlers run before setRemoteDescription resolves,
   *  triggering "Got a remote candidate without remote description" errors. */
  private processingChain: Promise<void>;

  constructor(deps: PeerConnectionDeps) {
    this.deps = deps;
    // Failed init (e.g. polyfill import failure) must surface as a close so
    // the peer doesn't zombie in NostrRoom's connections map.
    this.processingChain = this.init().catch((e) => {
      dbg(`peer-connection: init failed: ${String(e)}`);
      this.close();
    });
  }

  /** Process an incoming signaling message. Queued after init and any prior
   *  in-flight signaling so messages are applied in order. */
  receiveSignaling(msg: SignalingMessage): Promise<void> {
    if (this.closed) return Promise.resolve();
    this.processingChain = this.processingChain.then(() => this.applySignaling(msg));
    return this.processingChain;
  }

  sendCtrl(raw: string): void {
    if (this.closed) return;
    if (this.ctrlChannel !== null && this.ctrlChannel.readyState === 'open') {
      try {
        this.ctrlChannel.send(raw);
      } catch (e) {
        dbg(`peer-connection: ctrl send error: ${String(e)}`);
      }
      return;
    }
    if (this.ctrlBuffer.length >= MAX_CTRL_BUFFER) {
      dbg(`peer-connection: ${this.shortKey()} ctrl buffer full — dropping message`);
      return;
    }
    this.ctrlBuffer.push(raw);
  }

  sendTick(raw: string): void {
    if (this.closed) return;
    if (this.tickChannel !== null && this.tickChannel.readyState === 'open') {
      try {
        this.tickChannel.send(raw);
      } catch (e) {
        dbg(`peer-connection: tick send error: ${String(e)}`);
      }
      return;
    }
    if (this.tickBuffer.length >= MAX_TICK_BUFFER) {
      this.tickBuffer.shift();
    }
    this.tickBuffer.push(raw);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.ctrlBuffer = [];
    this.tickBuffer = [];
    try {
      this.pc?.close();
    } catch {
      // swallow — polyfill may throw on double-close
    }
    this.deps.onClose();
  }

  get isOpen(): boolean {
    return this.opened;
  }

  // ---- internal ----

  private async applySignaling(msg: SignalingMessage): Promise<void> {
    if (this.closed || this.pc === null) return;
    try {
      if (msg.t === 'offer') {
        await this.pc.setRemoteDescription({ type: 'offer', sdp: msg.sdp });
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        // Fall back to the raw answer SDP if localDescription is null (polyfill
        // edge case). A silent drop would hang the handshake forever.
        const sdp = this.pc.localDescription?.sdp ?? answer.sdp;
        this.deps.sendSignaling({ t: 'answer', sdp });
      } else if (msg.t === 'answer') {
        await this.pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
      } else if (msg.t === 'ice') {
        await this.pc.addIceCandidate({ candidate: msg.candidate, sdpMid: msg.mid });
      }
    } catch (e) {
      dbg(`peer-connection: signaling error from ${this.shortKey()}: ${String(e)}`);
    }
  }

  private async init(): Promise<void> {
    const mod = (await import('node-datachannel/polyfill')) as unknown as {
      RTCPeerConnection: new (config: unknown) => PC;
    };
    if (this.closed) return;
    this.pc = new mod.RTCPeerConnection(RTC_CONFIG);

    this.pc.onicecandidate = (ev: {
      candidate: { candidate: string; sdpMid: string | null } | null;
    }) => {
      if (ev.candidate) {
        this.deps.sendSignaling({
          t: 'ice',
          candidate: ev.candidate.candidate,
          mid: ev.candidate.sdpMid ?? '',
        });
      }
    };

    this.pc.oniceconnectionstatechange = () => {
      const state = this.pc?.iceConnectionState;
      dbg(`peer-connection: ${this.shortKey()} iceState=${state}`);
      if (state === 'failed' || state === 'disconnected' || state === 'closed') {
        this.close();
      }
    };

    if (this.deps.isInitiator) {
      this.ctrlChannel = this.pc.createDataChannel(CHANNEL_CTRL, { ordered: true });
      this.tickChannel = this.pc.createDataChannel(CHANNEL_TICK, {
        ordered: false,
        maxRetransmits: 0,
      });
      this.attachChannel(this.ctrlChannel, CHANNEL_CTRL);
      this.attachChannel(this.tickChannel, CHANNEL_TICK);
      const offer = await this.pc.createOffer();
      if (this.closed) return;
      await this.pc.setLocalDescription(offer);
      if (this.closed) return;
      const sdp = this.pc.localDescription?.sdp ?? offer.sdp;
      this.deps.sendSignaling({ t: 'offer', sdp });
    } else {
      this.pc.ondatachannel = (ev: { channel: DC }) => {
        const label = ev.channel.label;
        if (label === CHANNEL_CTRL) {
          this.ctrlChannel = ev.channel;
          this.attachChannel(ev.channel, CHANNEL_CTRL);
        } else if (label === CHANNEL_TICK) {
          this.tickChannel = ev.channel;
          this.attachChannel(ev.channel, CHANNEL_TICK);
        }
      };
    }
  }

  private attachChannel(dc: DC, label: ChannelLabel): void {
    dc.onopen = () => {
      dbg(`peer-connection: ${this.shortKey()} ${label} open`);
      this.checkBothOpen();
    };
    dc.onclose = () => {
      dbg(`peer-connection: ${this.shortKey()} ${label} closed`);
      this.close();
    };
    dc.onmessage = (ev: { data: unknown }) => {
      const raw = typeof ev.data === 'string' ? ev.data : String(ev.data);
      if (label === CHANNEL_CTRL) this.deps.onCtrlMessage(raw);
      else this.deps.onTickMessage(raw);
    };
  }

  private checkBothOpen(): void {
    if (this.opened) return;
    if (this.ctrlChannel?.readyState !== 'open') return;
    if (this.tickChannel?.readyState !== 'open') return;
    this.opened = true;
    dbg(`peer-connection: ${this.shortKey()} fully open — flushing buffers`);
    for (const raw of this.ctrlBuffer) {
      try {
        this.ctrlChannel.send(raw);
      } catch {
        // swallow
      }
    }
    for (const raw of this.tickBuffer) {
      try {
        this.tickChannel.send(raw);
      } catch {
        // swallow
      }
    }
    this.ctrlBuffer = [];
    this.tickBuffer = [];
    this.deps.onOpen();
  }

  private shortKey(): string {
    return this.deps.remotePubkey.slice(0, 8);
  }
}
