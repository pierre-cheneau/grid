// Trystero adapter. The ONLY file in the entire codebase that imports from `trystero`.
// All higher layers (NetClient, lockstep, sync, etc.) talk to this `Room` interface.
// Tests inject a MockRoom that implements the same interface without any real WebRTC.
//
// The Trystero `joinRoom` returns a "room" with `onPeerJoin`, `onPeerLeave`, and a
// `makeAction(label)` factory that creates `[send, receive]` pairs per labelled
// data channel. We negotiate exactly two channels: `ctrl` (reliable, ordered) and
// `tick` (unreliable, unordered). All other channel labels are reserved for future
// versions per `docs/architecture/networking.md`.
//
// Stage 2 caveat: Trystero doesn't yet support per-channel reliability negotiation in
// every strategy; for the Nostr/WebRTC strategy, both labelled actions are reliable by
// default. INPUT loss tolerance is built into the lockstep timeout, so this is benign
// for v0.1. We can revisit if bandwidth pressure shows up.

import { CHANNEL_CTRL, CHANNEL_TICK } from './constants.js';
import { dbg } from './debug.js';

export interface Room {
  onPeerJoin(cb: (peerId: string) => void): void;
  onPeerLeave(cb: (peerId: string) => void): void;
  onCtrl(cb: (raw: string, peerId: string) => void): void;
  onTick(cb: (raw: string, peerId: string) => void): void;
  /** Send on the reliable channel. If `to` is given, send to that peer only. */
  sendCtrl(raw: string, to?: string): void;
  /** Broadcast on the unreliable channel. */
  sendTick(raw: string): void;
  leave(): Promise<void>;
}

export type RoomFactory = (roomKey: string, localPeerId: string) => Promise<Room>;

/**
 * Default factory: opens a real Trystero/Nostr room. Imported lazily so that test
 * code that injects a MockRoom doesn't pay the trystero load cost.
 */
export const createTrysteroRoom: RoomFactory = async (roomKey, localPeerId) => {
  dbg(`room: opening trystero/nostr room "${roomKey}" as ${localPeerId}`);
  // Lazy import keeps tests isolated and lets bundlers tree-shake. We import the
  // node-datachannel polyfill the same way: only when a real room is being created.
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
  // biome-ignore lint/suspicious/noExplicitAny: trystero accepts the polyfill ctor
  const room = joinRoom({ appId: 'grid', rtcPolyfill: polyfillCtor as any }, roomKey);
  const [sendCtrl, recvCtrl] = room.makeAction<string>(CHANNEL_CTRL);
  const [sendTick, recvTick] = room.makeAction<string>(CHANNEL_TICK);
  dbg('room: joinRoom returned; channels ctrl/tick negotiated');

  void selfId; // referenced to silence the unused warning; consumed by Trystero internally

  const adapter: Room = {
    onPeerJoin: (cb) =>
      room.onPeerJoin((peerId) => {
        dbg(`room: trystero onPeerJoin ${peerId}`);
        cb(peerId);
      }),
    onPeerLeave: (cb) =>
      room.onPeerLeave((peerId) => {
        dbg(`room: trystero onPeerLeave ${peerId}`);
        cb(peerId);
      }),
    onCtrl: (cb) =>
      recvCtrl((data, peerId) => {
        dbg(`room: ctrl recv from ${peerId}: ${String(data).slice(0, 100)}`);
        cb(String(data), peerId);
      }),
    onTick: (cb) =>
      recvTick((data, peerId) => {
        dbg(`room: tick recv from ${peerId}: ${String(data).slice(0, 100)}`);
        cb(String(data), peerId);
      }),
    sendCtrl: (raw, to) => {
      dbg(`room: ctrl send ${to ?? 'broadcast'}: ${raw.slice(0, 100)}`);
      if (to !== undefined) sendCtrl(raw, to);
      else sendCtrl(raw);
    },
    sendTick: (raw) => {
      dbg(`room: tick send: ${raw.slice(0, 100)}`);
      sendTick(raw);
    },
    leave: async () => {
      dbg('room: leaving');
      await room.leave();
    },
  };
  return adapter;
};
