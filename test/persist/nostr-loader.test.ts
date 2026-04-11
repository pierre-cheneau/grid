import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { NOSTR_KIND_CELL_SNAPSHOT } from '../../src/net/nostr-events.js';
import type { Filter, NostrEvent } from '../../src/net/nostr.js';
import { loadNostrSnapshot } from '../../src/persist/nostr-loader.js';
import { compressSnapshot, encodeSnapshot } from '../../src/persist/snapshot.js';
import { cellKey } from '../../src/sim/grid.js';
import type { Cell, Config } from '../../src/sim/types.js';

const TEST_CONFIG: Config = {
  width: 250,
  height: 250,
  halfLifeTicks: 100,
  seed: 0n,
  circular: true,
};

function makeCell(tick: number, owner = 'p:test'): Cell {
  return { type: 'trail', ownerId: owner, createdAtTick: tick, colorSeed: 0 };
}

function makeFakeEvent(
  cells: Map<string, Cell>,
  tick: number,
  dayTag: string,
  tileX = 0,
  tileY = 0,
): NostrEvent {
  const raw = encodeSnapshot({ tick, config: TEST_CONFIG, cells });
  const compressed = compressSnapshot(raw);
  return {
    id: `fake-id-${Math.random().toString(36).slice(2)}`,
    pubkey: 'fake-pubkey',
    created_at: Math.floor(Date.now() / 1000),
    kind: NOSTR_KIND_CELL_SNAPSHOT,
    tags: [['d', `grid:${dayTag}:t:${tileX}-${tileY}`]],
    content: Buffer.from(compressed).toString('base64'),
    sig: 'fake-sig',
  };
}

class MockNostrPool {
  readonly pubkey = 'mock-pubkey';
  private readonly events: NostrEvent[] = [];
  private verifyResult = true;

  addEvent(event: NostrEvent): void {
    this.events.push(event);
  }

  setVerifyResult(result: boolean): void {
    this.verifyResult = result;
  }

  async fetch(filter: Filter): Promise<NostrEvent[]> {
    const dTags = (filter as Record<string, unknown>)['#d'] as string[] | undefined;
    if (!dTags) return [];
    return this.events.filter((e) => {
      const eventD = e.tags.find((t) => t[0] === 'd')?.[1];
      return eventD !== undefined && dTags.includes(eventD);
    });
  }

  verify(_event: NostrEvent): boolean {
    return this.verifyResult;
  }
}

describe('loadNostrSnapshot', () => {
  it('loads cells from a single event', async () => {
    const pool = new MockNostrPool();
    const cells = new Map<string, Cell>();
    cells.set(cellKey(10, 20), makeCell(650));
    cells.set(cellKey(50, 60), makeCell(680));
    pool.addEvent(makeFakeEvent(cells, 700, '2026-04-10'));

    // biome-ignore lint/suspicious/noExplicitAny: mock pool for testing
    const result = await loadNostrSnapshot(pool as any, '2026-04-10', TEST_CONFIG, 700);
    assert.ok(result !== null);
    assert.equal(result.cells.size, 2);
    assert.equal(result.latestTick, 700);
  });

  it('merges multiple events via CRDT', async () => {
    const pool = new MockNostrPool();

    const cells1 = new Map<string, Cell>();
    cells1.set(cellKey(10, 20), makeCell(100, 'alice'));
    pool.addEvent(makeFakeEvent(cells1, 100, '2026-04-10'));

    const cells2 = new Map<string, Cell>();
    cells2.set(cellKey(10, 20), makeCell(200, 'bob')); // same key, newer tick
    cells2.set(cellKey(30, 40), makeCell(200, 'bob'));
    pool.addEvent(makeFakeEvent(cells2, 200, '2026-04-10'));

    // biome-ignore lint/suspicious/noExplicitAny: mock pool for testing
    const result = await loadNostrSnapshot(pool as any, '2026-04-10', TEST_CONFIG, 200);
    assert.ok(result !== null);
    assert.equal(result.cells.size, 2);
    // Latest tick wins for overlapping key
    assert.equal(result.cells.get(cellKey(10, 20))?.ownerId, 'bob');
    assert.equal(result.latestTick, 200);
  });

  it('returns null when no events found', async () => {
    const pool = new MockNostrPool();
    // biome-ignore lint/suspicious/noExplicitAny: mock pool for testing
    const result = await loadNostrSnapshot(pool as any, '2026-04-10', TEST_CONFIG, 1000);
    assert.equal(result, null);
  });

  it('skips events with bad signatures', async () => {
    const pool = new MockNostrPool();
    pool.setVerifyResult(false);
    const cells = new Map<string, Cell>();
    cells.set(cellKey(10, 20), makeCell(500));
    pool.addEvent(makeFakeEvent(cells, 500, '2026-04-10'));

    // biome-ignore lint/suspicious/noExplicitAny: mock pool for testing
    const result = await loadNostrSnapshot(pool as any, '2026-04-10', TEST_CONFIG, 500);
    assert.equal(result, null);
  });

  it('filters expired cells', async () => {
    const pool = new MockNostrPool();
    const cells = new Map<string, Cell>();
    cells.set(cellKey(10, 20), makeCell(100)); // will be expired at tick 500 (age 400 > 2×100)
    cells.set(cellKey(30, 40), makeCell(450)); // will survive (age 50 < 200)
    pool.addEvent(makeFakeEvent(cells, 450, '2026-04-10'));

    // biome-ignore lint/suspicious/noExplicitAny: mock pool for testing
    const result = await loadNostrSnapshot(pool as any, '2026-04-10', TEST_CONFIG, 500);
    assert.ok(result !== null);
    assert.equal(result.cells.size, 1);
    assert.ok(result.cells.has(cellKey(30, 40)));
  });

  it('survives fetch errors without crashing', async () => {
    const pool = new MockNostrPool();
    // Override fetch to throw
    pool.fetch = async () => {
      throw new Error('relay unreachable');
    };
    // biome-ignore lint/suspicious/noExplicitAny: mock pool for testing
    const result = await loadNostrSnapshot(pool as any, '2026-04-10', TEST_CONFIG, 500);
    assert.equal(result, null);
  });

  it('skips events with corrupt content', async () => {
    const pool = new MockNostrPool();
    pool.addEvent({
      id: 'bad-event',
      pubkey: 'fake',
      created_at: 0,
      kind: NOSTR_KIND_CELL_SNAPSHOT,
      tags: [['d', 'grid:2026-04-10:t:0-0']],
      content: 'not-valid-base64!!!',
      sig: 'fake',
    });
    // biome-ignore lint/suspicious/noExplicitAny: mock pool for testing
    const result = await loadNostrSnapshot(pool as any, '2026-04-10', TEST_CONFIG, 500);
    assert.equal(result, null);
  });

  it('tracks latestTick across events at different ticks', async () => {
    const pool = new MockNostrPool();
    pool.addEvent(makeFakeEvent(new Map([[cellKey(1, 1), makeCell(90)]]), 100, '2026-04-10'));
    pool.addEvent(makeFakeEvent(new Map([[cellKey(2, 2), makeCell(190)]]), 200, '2026-04-10'));
    pool.addEvent(makeFakeEvent(new Map([[cellKey(3, 3), makeCell(140)]]), 150, '2026-04-10'));

    // biome-ignore lint/suspicious/noExplicitAny: mock pool for testing
    const result = await loadNostrSnapshot(pool as any, '2026-04-10', TEST_CONFIG, 200);
    assert.ok(result !== null);
    assert.equal(result.latestTick, 200);
  });

  it('works with multi-tile world config', async () => {
    const pool = new MockNostrPool();
    const bigConfig: Config = { ...TEST_CONFIG, width: 300, height: 250 };

    // Tile (0,0)
    const cells0 = new Map<string, Cell>([[cellKey(10, 10), makeCell(90)]]);
    pool.addEvent(makeFakeEvent(cells0, 100, '2026-04-10', 0, 0));

    // Tile (1,0)
    const cells1 = new Map<string, Cell>([[cellKey(270, 10), makeCell(90)]]);
    pool.addEvent(makeFakeEvent(cells1, 100, '2026-04-10', 1, 0));

    // biome-ignore lint/suspicious/noExplicitAny: mock pool for testing
    const result = await loadNostrSnapshot(pool as any, '2026-04-10', bigConfig, 100);
    assert.ok(result !== null);
    assert.equal(result.cells.size, 2);
  });
});
