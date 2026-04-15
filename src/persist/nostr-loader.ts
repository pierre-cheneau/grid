// Nostr cold start: fetch latest tile snapshots, verify, merge, decay.
//
// On cold start, the client fetches the latest cell snapshot events from
// Nostr relays for all tiles covering the world. Events are verified
// (Schnorr signature check), decoded, merged via CRDT, and filtered for
// expiry. The result is a cell map ready to inject into the initial state.

import { dbg } from '../net/debug.js';
import { NOSTR_KIND_CELL_SNAPSHOT, cellSnapshotTopic } from '../net/nostr-events.js';
import type { NostrPool } from '../net/nostr.js';
import type { Cell, Config, Tick } from '../sim/types.js';
import { decodeSnapshot, decompressSnapshot, filterExpiredCells } from './snapshot.js';
import { mergeCellMaps, worldTiles } from './tile.js';

export interface NostrLoadResult {
  readonly cells: Map<string, Cell>;
  readonly latestTick: Tick;
}

/** Fetch latest cell snapshots from Nostr for all world tiles.
 *  Returns merged + decay-filtered cells, or null if nothing found. */
export async function loadNostrSnapshot(
  pool: NostrPool,
  dayTag: string,
  config: Config,
  currentTick: Tick,
): Promise<NostrLoadResult | null> {
  const tiles = worldTiles(config.width, config.height);
  dbg(`nostr-loader: fetching ${tiles.length} tile(s) for ${dayTag}`);

  // Fetch all tiles in parallel
  const fetches = tiles.map(({ tileX, tileY }) =>
    pool
      .fetch({
        kinds: [NOSTR_KIND_CELL_SNAPSHOT],
        '#d': [cellSnapshotTopic(dayTag, tileX, tileY)],
        limit: 5,
      })
      .catch(() => []),
  );
  const results = await Promise.all(fetches);

  let merged = new Map<string, Cell>();
  let latestTick = 0;
  let eventCount = 0;

  for (const events of results) {
    for (const event of events) {
      if (!pool.verify(event)) {
        dbg(`nostr-loader: skipping event with bad signature id=${event.id?.slice(0, 8)}`);
        continue;
      }
      try {
        const compressed = Buffer.from(event.content, 'base64');
        const raw = decompressSnapshot(new Uint8Array(compressed));
        const snap = decodeSnapshot(raw);
        merged = mergeCellMaps(merged, snap.cells);
        if (snap.tick > latestTick) latestTick = snap.tick;
        eventCount++;
      } catch {
        dbg(`nostr-loader: failed to decode event id=${event.id?.slice(0, 8)}`);
      }
    }
  }

  if (eventCount === 0) {
    dbg('nostr-loader: no valid snapshots found');
    return null;
  }

  const filtered = filterExpiredCells(merged, currentTick, config.halfLifeTicks);
  dbg(
    `nostr-loader: loaded ${filtered.size} cells from ${eventCount} event(s) (${merged.size - filtered.size} expired)`,
  );
  return { cells: filtered, latestTick };
}
