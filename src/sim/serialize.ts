// Canonical byte serialization for the simulation state.
//
// This file defines THE on-the-wire byte layout that the canonical hash is computed
// over. Every field is fixed-width little-endian, every collection is iterated in
// `iter.ts` sorted order, and there is no JSON anywhere — JSON's whitespace tolerance
// and number-formatting choices are exactly the kinds of things that break determinism
// across language ports.
//
// The format is versioned (`FORMAT_VERSION = 1`) so a future change to the layout can
// be detected by readers without ambiguity. Bumping the version invalidates every
// pinned hash test in the repo and every replay file in the wild — do not bump
// casually. The pinned hash test in `test/sim/hash.test.ts` is the canary.
//
// LAYOUT (all little-endian, all integer):
//   0..4   "GRID" magic (4 ASCII bytes)
//   4      format version u8
//   5..9   tick u32
//   9..11  config.width u16
//   11..13 config.height u16
//   13..17 config.halfLifeTicks u32
//   17..25 config.seed u64
//   25     config.circular u8 (0=rect, 1=circle)
//   26..34 rng.state u64
//   33..37 players.size u32
//   then for each player in sortedKeys order:
//     id: u16 length-prefix + UTF-8 bytes
//     pos.x i16, pos.y i16
//     dir u8
//     isAlive u8 (0/1)
//     respawnAtTick: u8 tag (0=null, 1=present) + u32 if present
//     score u32
//     colorSeed u32
//   cells.size u32
//   then for each cell in sortedKeys (row-major y,x) order:
//     key: 8 ASCII hex bytes
//     type u8 (0=trail, 1=wall)
//     ownerId: u16 length-prefix + UTF-8 bytes
//     createdAtTick u32
//     colorSeed u32

import { sortedEntries } from './iter.js';
import type { CellType, GridState } from './types.js';

const MAGIC = new Uint8Array([0x47, 0x52, 0x49, 0x44]); // "GRID"
const FORMAT_VERSION = 2;

const CELL_TYPE_TAG: Record<CellType, number> = {
  trail: 0,
  wall: 1,
};

/**
 * Append-style byte writer over a growing `Uint8Array`. Cheap to construct, no Node
 * dependencies. We pre-grow by doubling so total work is O(n) regardless of state size.
 */
export class ByteWriter {
  private buf: Uint8Array;
  private view: DataView;
  private pos = 0;
  private readonly textEncoder = new TextEncoder();

  constructor(initialCapacity = 1024) {
    this.buf = new Uint8Array(initialCapacity);
    this.view = new DataView(this.buf.buffer);
  }

  private ensure(extra: number): void {
    const need = this.pos + extra;
    if (need <= this.buf.length) return;
    let cap = this.buf.length;
    while (cap < need) cap *= 2;
    const grown = new Uint8Array(cap);
    grown.set(this.buf);
    this.buf = grown;
    this.view = new DataView(this.buf.buffer);
  }

  bytes(b: Uint8Array): void {
    this.ensure(b.length);
    this.buf.set(b, this.pos);
    this.pos += b.length;
  }

  u8(n: number): void {
    this.ensure(1);
    this.view.setUint8(this.pos, n);
    this.pos += 1;
  }

  u16(n: number): void {
    this.ensure(2);
    this.view.setUint16(this.pos, n, true);
    this.pos += 2;
  }

  i16(n: number): void {
    this.ensure(2);
    this.view.setInt16(this.pos, n, true);
    this.pos += 2;
  }

  u32(n: number): void {
    this.ensure(4);
    this.view.setUint32(this.pos, n, true);
    this.pos += 4;
  }

  u64(n: bigint): void {
    this.ensure(8);
    this.view.setBigUint64(this.pos, n, true);
    this.pos += 8;
  }

  /** Length-prefixed (u16) UTF-8 string. */
  lenString(s: string): void {
    const utf8 = this.textEncoder.encode(s);
    if (utf8.length > 0xff_ff) {
      throw new Error(`serialize: string too long (${utf8.length} bytes)`);
    }
    this.u16(utf8.length);
    this.bytes(utf8);
  }

  finish(): Uint8Array {
    return this.buf.slice(0, this.pos);
  }
}

/**
 * Encode a `GridState` as the canonical byte sequence used for hashing and replay.
 *
 * Two states that are observably equal — same fields, same map contents, regardless
 * of map insertion order — must produce byte-identical output. The property test
 * `insertion-order independence` enforces this.
 */
export function canonicalBytes(state: GridState): Uint8Array {
  const w = new ByteWriter();

  w.bytes(MAGIC);
  w.u8(FORMAT_VERSION);
  w.u32(state.tick);

  w.u16(state.config.width);
  w.u16(state.config.height);
  w.u32(state.config.halfLifeTicks);
  w.u64(state.config.seed);
  w.u8(state.config.circular ? 1 : 0);

  w.u64(state.rng.state);

  // Players, sorted by id.
  w.u32(state.players.size);
  for (const [, player] of sortedEntries(state.players)) {
    w.lenString(player.id);
    w.i16(player.pos.x);
    w.i16(player.pos.y);
    w.u8(player.dir);
    w.u8(player.isAlive ? 1 : 0);
    if (player.respawnAtTick === null) {
      w.u8(0);
    } else {
      w.u8(1);
      w.u32(player.respawnAtTick);
    }
    w.u32(player.score);
    w.u32(player.colorSeed);
  }

  // Cells, sorted by cellKey (row-major y,x).
  w.u32(state.cells.size);
  for (const [key, cell] of sortedEntries(state.cells)) {
    // The key is already 8 ASCII hex chars; emit raw to avoid the length prefix.
    for (let i = 0; i < 8; i++) {
      w.u8(key.charCodeAt(i));
    }
    w.u8(CELL_TYPE_TAG[cell.type]);
    w.lenString(cell.ownerId);
    w.u32(cell.createdAtTick);
    w.u32(cell.colorSeed);
  }

  return w.finish();
}
