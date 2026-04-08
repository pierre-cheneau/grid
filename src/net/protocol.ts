// THE validation boundary for the network layer.
//
// Per `docs/engineering/errors-and-boundaries.md`: every network message is parsed
// and validated here, then trusted by the rest of the net layer. A peer that produces
// 10+ consecutive ProtocolErrors is evicted.
//
// `parseMessage(raw, sender)` is the only entry point. It returns a strongly-typed
// `Message` or throws `ProtocolError`. Internal callers never see partially-validated
// data and never need to re-check fields.

import { TICK_MAX } from '../sim/index.js';
import type { Tick, Turn } from '../sim/index.js';
import { MAX_MESSAGE_BYTES, MAX_SNAPSHOT_MESSAGE_BYTES, PROTOCOL_V } from './constants.js';
import {
  type ByeMsg,
  type EvictMsg,
  type EvictReason,
  type HelloMsg,
  type InputMsg,
  type KickedMsg,
  type Message,
  type MessageType,
  type PeerKind,
  ProtocolError,
  type StateHashMsg,
  type StateRequestMsg,
  type StateResponseMsg,
} from './messages.js';

const KNOWN_TYPES: ReadonlySet<string> = new Set<MessageType>([
  'HELLO',
  'INPUT',
  'STATE_HASH',
  'EVICT',
  'STATE_REQUEST',
  'STATE_RESPONSE',
  'KICKED',
  'BYE',
]);

const VALID_TURNS: ReadonlySet<string> = new Set(['', 'L', 'R', 'X']);
const VALID_REASONS: ReadonlySet<string> = new Set<EvictReason>([
  'hash_mismatch',
  'timeout',
  'disconnect',
]);
const VALID_KINDS: ReadonlySet<string> = new Set<PeerKind>(['pilot', 'daemon']);

const ID_LEN_MAX = 64;
const HASH_HEX_LEN = 16;
const CLIENT_STR_MAX = 64;
const STATE_B64_MAX = MAX_SNAPSHOT_MESSAGE_BYTES;

function bad(reason: string): never {
  throw new ProtocolError(reason);
}

function isString(v: unknown): v is string {
  return typeof v === 'string';
}

function isFiniteInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v);
}

function expectString(o: Record<string, unknown>, key: string, max: number): string {
  const v = o[key];
  if (!isString(v)) bad(`field "${key}" must be a string`);
  if (v.length === 0 || v.length > max) bad(`field "${key}" length out of range (1..${max})`);
  return v;
}

function expectTick(o: Record<string, unknown>): Tick {
  const v = o['tick'];
  if (!isFiniteInt(v) || v < 0 || v > TICK_MAX) bad('field "tick" out of range');
  return v as Tick;
}

function expectId(o: Record<string, unknown>, key: string): string {
  const v = expectString(o, key, ID_LEN_MAX);
  // Cheap shape check; the same alphabet as `src/id/identity.ts`.
  if (!/^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+$/.test(v)) bad(`field "${key}" not a valid id`);
  return v;
}

/**
 * Parse + validate a raw message line. `sender` is the peer id Trystero gives us;
 * the parsed `from` field MUST equal it (anti-spoofing).
 */
export function parseMessage(raw: string, sender: string): Message {
  if (typeof raw !== 'string') bad('raw message is not a string');

  // Permit oversized messages only if they look like a STATE_RESPONSE; otherwise
  // a peer can crash us by sending megabytes of garbage in any message type.
  const looksSnapshot = raw.length > MAX_MESSAGE_BYTES;
  if (looksSnapshot) {
    if (raw.length > STATE_B64_MAX) bad('message exceeds snapshot cap');
    if (!raw.includes('"STATE_RESPONSE"')) bad('oversized message is not a snapshot');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    bad('invalid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    bad('top-level value is not an object');
  }
  const o = parsed as Record<string, unknown>;

  if (o['v'] !== PROTOCOL_V) bad(`unsupported protocol version ${String(o['v'])}`);
  const t = o['t'];
  if (!isString(t) || !KNOWN_TYPES.has(t)) bad(`unknown message type ${String(t)}`);
  const from = expectId(o, 'from');
  if (from !== sender) bad(`from "${from}" does not match sender "${sender}"`);

  switch (t as MessageType) {
    case 'HELLO': {
      const color = o['color'];
      if (!Array.isArray(color) || color.length !== 3) bad('color must be a 3-tuple');
      const rgb = color.map((c) => {
        if (!isFiniteInt(c) || c < 0 || c > 255) bad('color component out of range');
        return c as number;
      }) as [number, number, number];
      const kind = o['kind'];
      if (!isString(kind) || !VALID_KINDS.has(kind)) bad('invalid kind');
      const client = expectString(o, 'client', CLIENT_STR_MAX);
      const joinedAt = o['joined_at'];
      if (!isFiniteInt(joinedAt) || joinedAt < 0) bad('joined_at out of range');
      const msg: HelloMsg = {
        v: 1,
        t: 'HELLO',
        from,
        color: rgb,
        kind: kind as PeerKind,
        client,
        joined_at: joinedAt,
      };
      return msg;
    }
    case 'INPUT': {
      const tick = expectTick(o);
      const i = o['i'];
      if (!isString(i) || !VALID_TURNS.has(i)) bad('invalid turn');
      const msg: InputMsg = { v: 1, t: 'INPUT', from, tick, i: i as Turn };
      return msg;
    }
    case 'STATE_HASH': {
      const tick = expectTick(o);
      const h = o['h'];
      if (!isString(h) || h.length !== HASH_HEX_LEN || !/^[0-9a-f]{16}$/.test(h)) {
        bad('invalid hash');
      }
      const msg: StateHashMsg = { v: 1, t: 'STATE_HASH', from, tick, h };
      return msg;
    }
    case 'EVICT': {
      const target = expectId(o, 'target');
      const reason = o['reason'];
      if (!isString(reason) || !VALID_REASONS.has(reason)) bad('invalid reason');
      const tick = expectTick(o);
      const msg: EvictMsg = {
        v: 1,
        t: 'EVICT',
        from,
        target,
        reason: reason as EvictReason,
        tick,
      };
      return msg;
    }
    case 'STATE_REQUEST': {
      const msg: StateRequestMsg = { v: 1, t: 'STATE_REQUEST', from };
      return msg;
    }
    case 'STATE_RESPONSE': {
      const to = expectId(o, 'to');
      const tick = expectTick(o);
      const stateB64 = o['state_b64'];
      if (!isString(stateB64) || stateB64.length === 0 || stateB64.length > STATE_B64_MAX) {
        bad('state_b64 out of range');
      }
      if (!/^[A-Za-z0-9+/=]+$/.test(stateB64)) bad('state_b64 not base64');
      const msg: StateResponseMsg = {
        v: 1,
        t: 'STATE_RESPONSE',
        from,
        to,
        tick,
        state_b64: stateB64,
      };
      return msg;
    }
    case 'KICKED': {
      const to = expectId(o, 'to');
      const reason = o['reason'];
      if (!isString(reason) || !VALID_REASONS.has(reason)) bad('invalid reason');
      const msg: KickedMsg = { v: 1, t: 'KICKED', from, to, reason: reason as EvictReason };
      return msg;
    }
    case 'BYE': {
      const msg: ByeMsg = { v: 1, t: 'BYE', from };
      return msg;
    }
  }
}

/** Encode a message for the wire. Newline framing is the caller's responsibility. */
export function encodeMessage(msg: Message): string {
  return JSON.stringify(msg);
}
