// Compact cell snapshot codec for local persistence and Nostr backup.
//
// The snapshot encodes only the grid's cell map and config — players are NOT
// persisted. On cold start the player list is empty; players rejoin via the
// normal HELLO/join flow.
//
// Format (all little-endian):
//   0..4   "GSNP" magic
//   4      version u8
//   5..9   tick u32
//   9..11  config.width u16
//   11..13 config.height u16
//   13..17 config.halfLifeTicks u32
//   17..25 config.seed u64
//   25     config.circular u8 (0 = false, 1 = true)
//   26..30 cellCount u32
//   then for each cell in sorted key order:
//     key: 8 ASCII hex bytes
//     type u8
//     ownerId: u16 length-prefix + UTF-8 bytes
//     createdAtTick u32
//     colorSeed u32

import { gunzipSync, gzipSync } from 'node:zlib';
import { sortedEntries } from '../sim/iter.js';
import { ByteWriter } from '../sim/serialize.js';
import type { Cell, CellType, Config, Tick } from '../sim/types.js';

const MAGIC = new Uint8Array([0x47, 0x53, 0x4e, 0x50]); // "GSNP"
const SNAPSHOT_VERSION = 1;
const CELL_TYPE_TAG: Record<CellType, number> = { trail: 0, wall: 1 };
const CELL_TYPE_FROM_TAG: ReadonlyArray<CellType> = ['trail', 'wall'];

export interface SnapshotData {
  readonly tick: Tick;
  readonly config: Config;
  readonly cells: ReadonlyMap<string, Cell>;
}

/** Encode a cell snapshot as raw bytes (uncompressed). */
export function encodeSnapshot(data: SnapshotData): Uint8Array {
  const w = new ByteWriter(30 + data.cells.size * 40);

  // Header
  w.bytes(MAGIC);
  w.u8(SNAPSHOT_VERSION);
  w.u32(data.tick);
  w.u16(data.config.width);
  w.u16(data.config.height);
  w.u32(data.config.halfLifeTicks);
  w.u64(data.config.seed);
  w.u8(data.config.circular ? 1 : 0);
  w.u32(data.cells.size);

  // Cells in sorted order
  for (const [key, cell] of sortedEntries(data.cells)) {
    for (let i = 0; i < 8; i++) w.u8(key.charCodeAt(i));
    w.u8(CELL_TYPE_TAG[cell.type]);
    w.lenString(cell.ownerId);
    w.u32(cell.createdAtTick);
    w.u32(cell.colorSeed);
  }

  return w.finish();
}

/** Decode a raw (uncompressed) cell snapshot. */
export function decodeSnapshot(bytes: Uint8Array): SnapshotData {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let pos = 0;

  // Magic
  for (let i = 0; i < 4; i++) {
    if (bytes[pos++] !== MAGIC[i]) throw new Error('snapshot: bad magic');
  }
  const version = view.getUint8(pos++);
  if (version !== SNAPSHOT_VERSION) {
    throw new Error(`snapshot: unsupported version ${version}`);
  }

  const tick = view.getUint32(pos, true);
  pos += 4;
  const width = view.getUint16(pos, true);
  pos += 2;
  const height = view.getUint16(pos, true);
  pos += 2;
  const halfLifeTicks = view.getUint32(pos, true);
  pos += 4;
  const seed = view.getBigUint64(pos, true);
  pos += 8;
  const circular = view.getUint8(pos++) !== 0;
  const config: Config = { width, height, halfLifeTicks, seed, circular };

  const cellCount = view.getUint32(pos, true);
  pos += 4;

  const cells = new Map<string, Cell>();
  for (let i = 0; i < cellCount; i++) {
    let key = '';
    for (let j = 0; j < 8; j++) key += String.fromCharCode(bytes[pos++] ?? 0);
    const typeTag = view.getUint8(pos++);
    const type = CELL_TYPE_FROM_TAG[typeTag];
    if (type === undefined) throw new Error(`snapshot: bad cell type ${typeTag}`);
    const ownerLen = view.getUint16(pos, true);
    pos += 2;
    const ownerId = decoder.decode(bytes.slice(pos, pos + ownerLen));
    pos += ownerLen;
    const createdAtTick = view.getUint32(pos, true);
    pos += 4;
    const colorSeed = view.getUint32(pos, true);
    pos += 4;
    cells.set(key, { type, ownerId, createdAtTick, colorSeed });
  }

  return { tick, config, cells };
}

/** Compress a snapshot for disk/network storage. */
export function compressSnapshot(raw: Uint8Array): Uint8Array {
  return gzipSync(raw);
}

/** Decompress a snapshot from disk/network storage. */
export function decompressSnapshot(compressed: Uint8Array): Uint8Array {
  const buf = gunzipSync(compressed);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

/** Filter out cells that have decayed past the hard ceiling (2 * halfLifeTicks). */
export function filterExpiredCells(
  cells: ReadonlyMap<string, Cell>,
  currentTick: Tick,
  halfLifeTicks: number,
): Map<string, Cell> {
  const ceiling = 2 * halfLifeTicks;
  const alive = new Map<string, Cell>();
  for (const [key, cell] of cells) {
    if (currentTick - cell.createdAtTick < ceiling) alive.set(key, cell);
  }
  return alive;
}
