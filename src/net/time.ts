// Time-anchoring utilities for the lockstep layer.
//
// The simulation's tick number is derived from wall-clock time within the day.
// This means cells decay in real time — even when no peers are online — because
// any returning peer can compute the current tick from its own clock.
//
// These functions live in `src/net/` (not `src/sim/`) because they touch the
// wall clock, which is forbidden inside the simulation boundary.

import { createHash } from 'node:crypto';
import { TICKS_PER_SECOND } from '../sim/index.js';

const MS_PER_TICK = 1000 / TICKS_PER_SECOND;

/** Midnight UTC of the day containing `nowMs` (milliseconds since epoch). */
export function dayStartMs(nowMs: number): number {
  const d = new Date(nowMs);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

/** The tick number corresponding to wall-clock `nowMs` within a day starting at `dayStart`. */
export function tickAtTime(nowMs: number, dayStart: number): number {
  return Math.max(0, Math.floor((nowMs - dayStart) / MS_PER_TICK));
}

/** Today's date as a `YYYY-MM-DD` string (UTC). Used for room keys and state files. */
export function todayTag(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/** Deterministic seed for a day's simulation. SHA-256 of the dayTag, truncated to 64 bits. */
export function seedFromDay(dayTag: string): bigint {
  const hash = createHash('sha256').update(dayTag, 'utf-8').digest();
  return hash.readBigUInt64LE(0);
}
