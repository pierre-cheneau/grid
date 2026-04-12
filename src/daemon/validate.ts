// Boundary validation for daemon outbound messages.
//
// Returns null on malformed input. Never throws — daemon errors are counted
// by the bridge, not propagated as exceptions.

import type { Turn } from '../sim/types.js';
import type { DaemonCmd, DaemonHelloAck } from './types.js';

const VALID_TURNS: ReadonlySet<string> = new Set(['', 'L', 'R', 'X']);

export function parseHelloAck(raw: string): DaemonHelloAck | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const o = parsed as Record<string, unknown>;
  if (o['t'] !== 'HELLO_ACK') return null;
  if (o['v'] !== 1) return null;
  if (typeof o['name'] !== 'string' || o['name'].length === 0 || o['name'].length > 64) return null;
  if (typeof o['author'] !== 'string' || o['author'].length > 64) return null;
  if (typeof o['version'] !== 'string' || o['version'].length > 32) return null;
  return {
    t: 'HELLO_ACK',
    v: 1,
    name: o['name'] as string,
    author: (o['author'] as string) || 'unknown',
    version: (o['version'] as string) || '0.0',
  };
}

export function parseCmd(raw: string, expectedTick: number): DaemonCmd | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const o = parsed as Record<string, unknown>;
  if (o['t'] !== 'CMD') return null;
  if (typeof o['n'] !== 'number' || o['n'] !== expectedTick) return null;
  const i = o['i'];
  if (typeof i !== 'string' || !VALID_TURNS.has(i)) return null;
  return { t: 'CMD', n: expectedTick, i: i as Turn };
}
