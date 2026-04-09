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
import { getPublicKey } from 'nostr-tools/pure';
import type { LocalIdentity } from './identity.js';
import { deriveLocalId, generateNostrKeypair } from './identity.js';

interface CacheData {
  readonly id: string;
  readonly colorSeed: number;
  readonly nostrSeckey: string; // hex-encoded
  readonly nostrPubkey: string; // hex-encoded
}

function defaultCacheDir(): string {
  return join(homedir(), '.grid');
}

const HEX64 = /^[0-9a-f]{64}$/;

/** Partial cache from v0.1 (no keypair). */
interface LegacyCacheData {
  readonly id: string;
  readonly colorSeed: number;
}

async function readCache(dir: string): Promise<CacheData | LegacyCacheData | null> {
  try {
    const raw = await readFile(join(dir, 'identity.json'), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('id' in parsed) ||
      !('colorSeed' in parsed) ||
      typeof (parsed as LegacyCacheData).id !== 'string' ||
      typeof (parsed as LegacyCacheData).colorSeed !== 'number'
    ) {
      return null;
    }
    const obj = parsed as Record<string, unknown>;
    // Full v0.2 cache with valid keypair
    if (
      typeof obj['nostrSeckey'] === 'string' &&
      typeof obj['nostrPubkey'] === 'string' &&
      HEX64.test(obj['nostrSeckey']) &&
      HEX64.test(obj['nostrPubkey'])
    ) {
      return {
        id: obj['id'] as string,
        colorSeed: obj['colorSeed'] as number,
        nostrSeckey: obj['nostrSeckey'],
        nostrPubkey: obj['nostrPubkey'],
      };
    }
    // v0.1 cache without keypair — will be migrated
    return { id: obj['id'] as string, colorSeed: obj['colorSeed'] as number };
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
    const joinedAt = Math.floor(now() / 1000);
    // Full v0.2 cache — verify seckey↔pubkey consistency before trusting
    if ('nostrSeckey' in cached) {
      const seckey = new Uint8Array(Buffer.from(cached.nostrSeckey, 'hex'));
      const derivedPubkey = getPublicKey(seckey);
      if (derivedPubkey === cached.nostrPubkey) {
        return {
          id: cached.id,
          colorSeed: cached.colorSeed,
          joinedAt,
          nostrSeckey: seckey,
          nostrPubkey: cached.nostrPubkey,
        };
      }
      // Mismatched keypair — regenerate (cache was hand-edited or corrupted)
    }
    // v0.1 cache — migrate by generating keypair
    const { seckey, pubkey } = generateNostrKeypair();
    const full: CacheData = {
      id: cached.id,
      colorSeed: cached.colorSeed,
      nostrSeckey: Buffer.from(seckey).toString('hex'),
      nostrPubkey: pubkey,
    };
    await writeCache(cacheDir, full).catch(() => {});
    return {
      id: cached.id,
      colorSeed: cached.colorSeed,
      joinedAt,
      nostrSeckey: seckey,
      nostrPubkey: pubkey,
    };
  }
  const fresh = deriveLocalId(now);
  await writeCache(cacheDir, {
    id: fresh.id,
    colorSeed: fresh.colorSeed,
    nostrSeckey: Buffer.from(fresh.nostrSeckey).toString('hex'),
    nostrPubkey: fresh.nostrPubkey,
  }).catch(() => {});
  return fresh;
}
