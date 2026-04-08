// Inverse of `serialize.ts`. Reads canonical bytes and reconstructs a `GridState`.
//
// CONTRACT: for any state `s`, `parseCanonicalBytes(canonicalBytes(s))` returns a state
// `s'` such that `canonicalBytes(s')` is byte-identical to `canonicalBytes(s)`. The
// property test in `test/sim/deserialize.test.ts` is the canary.
//
// Maps are constructed by inserting in canonical sort order. Because the serializer
// emits players sorted by id and cells sorted by cellKey (row-major), iterating the
// reconstructed maps via `iter.ts` after parsing yields the same order as iterating
// the originals — and serializing them produces the same bytes.
//
// This file is allowed inside `src/sim/` for the same reason `serialize.ts` is: it
// is pure CPU, no I/O, no platform clocks, no environment access. The boundary checker
// in `scripts/check-sim-boundary.ts` does not need updating.

import type { Cell, CellType, Config, GridState, Player, PlayerId, Tick } from './types.js';

const FORMAT_VERSION = 1;
const MAGIC_BYTES = [0x47, 0x52, 0x49, 0x44]; // "GRID"

const CELL_TYPE_FROM_TAG: ReadonlyArray<CellType> = ['trail', 'wall'];

class ByteReader {
  private readonly view: DataView;
  private pos = 0;
  private readonly textDecoder = new TextDecoder('utf-8', { fatal: true });

  constructor(private readonly buf: Uint8Array) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  private ensure(extra: number): void {
    if (this.pos + extra > this.buf.length) {
      throw new Error(`deserialize: truncated at ${this.pos} (need ${extra} more bytes)`);
    }
  }

  u8(): number {
    this.ensure(1);
    const v = this.view.getUint8(this.pos);
    this.pos += 1;
    return v;
  }

  u16(): number {
    this.ensure(2);
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }

  i16(): number {
    this.ensure(2);
    const v = this.view.getInt16(this.pos, true);
    this.pos += 2;
    return v;
  }

  u32(): number {
    this.ensure(4);
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }

  u64(): bigint {
    this.ensure(8);
    const v = this.view.getBigUint64(this.pos, true);
    this.pos += 8;
    return v;
  }

  /** Read N raw bytes; returns a fresh copy. */
  bytes(n: number): Uint8Array {
    this.ensure(n);
    const out = this.buf.slice(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }

  /** Length-prefixed (u16) UTF-8 string. */
  lenString(): string {
    const len = this.u16();
    const slice = this.bytes(len);
    return this.textDecoder.decode(slice);
  }

  get remaining(): number {
    return this.buf.length - this.pos;
  }
}

export function parseCanonicalBytes(bytes: Uint8Array): GridState {
  const r = new ByteReader(bytes);

  for (let i = 0; i < 4; i++) {
    if (r.u8() !== MAGIC_BYTES[i]) {
      throw new Error('deserialize: bad magic (not a GRID canonical state)');
    }
  }
  const version = r.u8();
  if (version !== FORMAT_VERSION) {
    throw new Error(
      `deserialize: unsupported FORMAT_VERSION ${version} (expected ${FORMAT_VERSION})`,
    );
  }

  const tick: Tick = r.u32();

  const config: Config = {
    width: r.u16(),
    height: r.u16(),
    halfLifeTicks: r.u32(),
    seed: r.u64(),
  };

  const rngState = r.u64();

  const playerCount = r.u32();
  const players = new Map<PlayerId, Player>();
  for (let i = 0; i < playerCount; i++) {
    const id = r.lenString();
    const x = r.i16();
    const y = r.i16();
    const dir = r.u8();
    if (dir > 3) throw new Error(`deserialize: bad direction ${dir}`);
    const isAlive = r.u8() === 1;
    const respawnTag = r.u8();
    let respawnAtTick: Tick | null;
    if (respawnTag === 0) {
      respawnAtTick = null;
    } else if (respawnTag === 1) {
      respawnAtTick = r.u32();
    } else {
      throw new Error(`deserialize: bad respawn tag ${respawnTag}`);
    }
    const score = r.u32();
    const colorSeed = r.u32();
    players.set(id, {
      id,
      pos: { x, y },
      dir: dir as 0 | 1 | 2 | 3,
      isAlive,
      respawnAtTick,
      score,
      colorSeed,
    });
  }

  const cellCount = r.u32();
  const cells = new Map<string, Cell>();
  for (let i = 0; i < cellCount; i++) {
    let key = '';
    for (let j = 0; j < 8; j++) {
      key += String.fromCharCode(r.u8());
    }
    const typeTag = r.u8();
    const type = CELL_TYPE_FROM_TAG[typeTag];
    if (type === undefined) throw new Error(`deserialize: bad cell type tag ${typeTag}`);
    const ownerId = r.lenString();
    const createdAtTick = r.u32();
    cells.set(key, { type, ownerId, createdAtTick });
  }

  if (r.remaining !== 0) {
    throw new Error(`deserialize: ${r.remaining} trailing bytes`);
  }

  return {
    tick,
    config,
    rng: { state: rngState },
    players,
    cells,
  };
}
