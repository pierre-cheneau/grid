// Local file persistence for cell snapshots.
//
// Writes compressed snapshots to `~/.grid/state-{dayTag}.bin`. On cold start,
// the client checks this file before falling back to an empty grid.
//
// Uses the same `~/.grid/` directory as the identity cache (`src/id/cache.ts`).
// Atomic write via `.tmp` + rename to avoid partial writes on crash.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

function defaultDir(): string {
  return join(homedir(), '.grid');
}

function stateFile(dayTag: string, cacheDir: string): string {
  return join(cacheDir, `state-${dayTag}.bin`);
}

/** Load a compressed snapshot for the given day, or null if none exists. */
export async function loadLocalSnapshot(
  dayTag: string,
  cacheDir?: string,
): Promise<Uint8Array | null> {
  try {
    const buf = await readFile(stateFile(dayTag, cacheDir ?? defaultDir()));
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  } catch {
    return null;
  }
}

/** Load yesterday's peak concurrent player count, or 0 if none saved. */
export async function loadPeakConcurrent(cacheDir?: string): Promise<number> {
  try {
    const raw = await readFile(join(cacheDir ?? defaultDir(), 'peak.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    if (typeof parsed?.peak === 'number' && parsed.peak >= 0) return parsed.peak;
    return 0;
  } catch {
    return 0;
  }
}

/** Save today's peak concurrent player count for tomorrow's world sizing. */
export async function savePeakConcurrent(peak: number, cacheDir?: string): Promise<void> {
  const dir = cacheDir ?? defaultDir();
  await mkdir(dir, { recursive: true });
  const path = join(dir, 'peak.json');
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify({ peak }), 'utf-8');
  await rename(tmp, path);
}

/** Save a compressed snapshot for the given day. Best-effort — failures are silent. */
export async function saveLocalSnapshot(
  dayTag: string,
  data: Uint8Array,
  cacheDir?: string,
): Promise<void> {
  const dir = cacheDir ?? defaultDir();
  await mkdir(dir, { recursive: true });
  const path = stateFile(dayTag, dir);
  const tmp = `${path}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, path);
}
