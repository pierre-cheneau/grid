// Identity cache: persist identity to ~/.grid/identity.json so the same machine
// always produces the same color, even after reinstalls.
//
// Per `docs/design/identity-and-aesthetic.md` line 15: "Identity is generated the
// first time the player runs `npx grid` and cached ... deleting it generates a
// fresh identity."
//
// The cache stores { id, colorSeed } — enough to reconstruct a LocalIdentity with
// a fresh joinedAt each session. Atomic write via .tmp + rename prevents corruption.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { LocalIdentity } from './identity.js';
import { deriveLocalId } from './identity.js';

interface CacheData {
  readonly id: string;
  readonly colorSeed: number;
}

function defaultCacheDir(): string {
  return join(homedir(), '.grid');
}

async function readCache(dir: string): Promise<CacheData | null> {
  try {
    const raw = await readFile(join(dir, 'identity.json'), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'id' in parsed &&
      'colorSeed' in parsed &&
      typeof (parsed as CacheData).id === 'string' &&
      typeof (parsed as CacheData).colorSeed === 'number'
    ) {
      return { id: (parsed as CacheData).id, colorSeed: (parsed as CacheData).colorSeed };
    }
    return null;
  } catch {
    return null;
  }
}

async function writeCache(dir: string, data: CacheData): Promise<void> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, 'identity.json');
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(data), 'utf8');
  await rename(tmp, path);
}

/**
 * Read cached identity or derive + cache a fresh one. Returns a LocalIdentity
 * with the cached id/colorSeed and a fresh joinedAt for this session.
 *
 * `cacheDir` is injectable for tests (default: `~/.grid`).
 */
export async function resolveIdentity(
  now: () => number = Date.now,
  cacheDir: string = defaultCacheDir(),
): Promise<LocalIdentity> {
  const cached = await readCache(cacheDir);
  if (cached !== null) {
    return { id: cached.id, colorSeed: cached.colorSeed, joinedAt: Math.floor(now() / 1000) };
  }
  const fresh = deriveLocalId(now);
  await writeCache(cacheDir, { id: fresh.id, colorSeed: fresh.colorSeed }).catch(() => {
    // Best-effort cache write. If the dir is read-only, we still play.
  });
  return fresh;
}
