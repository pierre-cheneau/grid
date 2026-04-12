import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  NOSTR_KIND_CELL_SNAPSHOT,
  NOSTR_KIND_CHAIN_ATTESTATION,
  NOSTR_KIND_WORLD_CONFIG,
} from '../../src/net/nostr-events.js';
import type { EventTemplate } from '../../src/net/nostr.js';
import { NostrPublisher, SNAPSHOT_PUBLISH_CADENCE } from '../../src/persist/nostr-publisher.js';
import { cellKey } from '../../src/sim/grid.js';
import type { Cell, Config } from '../../src/sim/types.js';

const TEST_CONFIG: Config = {
  width: 250,
  height: 250,
  halfLifeTicks: 100,
  seed: 0n,
  circular: true,
};

function makeCell(tick: number): Cell {
  return { type: 'trail', ownerId: 'p:test', createdAtTick: tick, colorSeed: 0 };
}

class SpyNostrPool {
  readonly published: EventTemplate[] = [];
  readonly pubkey = 'test-pubkey';

  async publish(template: EventTemplate): Promise<void> {
    this.published.push(template);
  }

  publishFireAndForget(template: EventTemplate): void {
    this.published.push(template);
  }
}

describe('NostrPublisher', () => {
  it('publishes on cadence ticks', () => {
    const pool = new SpyNostrPool();
    // biome-ignore lint/suspicious/noExplicitAny: spy pool for testing
    const pub = new NostrPublisher(pool as any, '2026-04-10', TEST_CONFIG);
    const cells = new Map<string, Cell>([[cellKey(10, 20), makeCell(SNAPSHOT_PUBLISH_CADENCE)]]);
    const hash = new Uint8Array(32);

    pub.onTick(SNAPSHOT_PUBLISH_CADENCE, cells, 'abc123', hash, 1);
    // Should publish: 1 cell snapshot + 1 chain attestation
    assert.equal(pool.published.length, 2);
    assert.equal(pool.published[0]?.kind, NOSTR_KIND_CELL_SNAPSHOT);
    assert.equal(pool.published[1]?.kind, NOSTR_KIND_CHAIN_ATTESTATION);
  });

  it('does not publish on non-cadence ticks', () => {
    const pool = new SpyNostrPool();
    // biome-ignore lint/suspicious/noExplicitAny: spy pool for testing
    const pub = new NostrPublisher(pool as any, '2026-04-10', TEST_CONFIG);
    const cells = new Map<string, Cell>([[cellKey(10, 20), makeCell(1)]]);
    const hash = new Uint8Array(32);

    pub.onTick(1, cells, 'abc123', hash, 1);
    pub.onTick(299, cells, 'abc123', hash, 1);
    pub.onTick(301, cells, 'abc123', hash, 1);
    assert.equal(pool.published.length, 0);
  });

  it('does not publish with empty cells', () => {
    const pool = new SpyNostrPool();
    // biome-ignore lint/suspicious/noExplicitAny: spy pool for testing
    const pub = new NostrPublisher(pool as any, '2026-04-10', TEST_CONFIG);

    pub.onTick(SNAPSHOT_PUBLISH_CADENCE, new Map(), 'abc123', new Uint8Array(32), 1);
    assert.equal(pool.published.length, 0);
  });

  it('publishes on multiple cadence ticks', () => {
    const pool = new SpyNostrPool();
    // biome-ignore lint/suspicious/noExplicitAny: spy pool for testing
    const pub = new NostrPublisher(pool as any, '2026-04-10', TEST_CONFIG);
    const cells = new Map<string, Cell>([[cellKey(10, 20), makeCell(300)]]);
    const hash = new Uint8Array(32);

    pub.onTick(300, cells, 'a', hash, 1);
    pub.onTick(600, cells, 'b', hash, 1);
    pub.onTick(900, cells, 'c', hash, 1);
    // 3 cadence ticks × 2 events each = 6
    assert.equal(pool.published.length, 6);
  });

  it('publishes world config event', () => {
    const pool = new SpyNostrPool();
    // biome-ignore lint/suspicious/noExplicitAny: spy pool for testing
    const pub = new NostrPublisher(pool as any, '2026-04-10', TEST_CONFIG);

    pub.publishWorldConfig(250, 250, 'deadbeef');
    assert.equal(pool.published.length, 1);
    assert.equal(pool.published[0]?.kind, NOSTR_KIND_WORLD_CONFIG);
  });

  it('resetForNewDay updates dayTag in subsequent publishes', () => {
    const pool = new SpyNostrPool();
    // biome-ignore lint/suspicious/noExplicitAny: spy pool for testing
    const pub = new NostrPublisher(pool as any, '2026-04-10', TEST_CONFIG);
    const cells = new Map<string, Cell>([[cellKey(10, 20), makeCell(300)]]);

    pub.resetForNewDay('2026-04-11');
    pub.onTick(300, cells, 'abc', new Uint8Array(32), 1);

    const snapshotEvent = pool.published[0];
    assert.ok(snapshotEvent);
    const dTag = snapshotEvent.tags.find((t) => t[0] === 'd')?.[1];
    assert.ok(dTag?.includes('2026-04-11'));
  });

  it('world with 2 tiles publishes 2 snapshot events', () => {
    const pool = new SpyNostrPool();
    const bigConfig: Config = { ...TEST_CONFIG, width: 300, height: 250 };
    // biome-ignore lint/suspicious/noExplicitAny: spy pool for testing
    const pub = new NostrPublisher(pool as any, '2026-04-10', bigConfig);

    const cells = new Map<string, Cell>();
    cells.set(cellKey(10, 20), makeCell(300)); // tile (0,0)
    cells.set(cellKey(270, 20), makeCell(300)); // tile (1,0)

    pub.onTick(300, cells, 'abc', new Uint8Array(32), 1);
    // 2 tile snapshots + 1 chain attestation = 3
    assert.equal(pool.published.length, 3);
    const snapshots = pool.published.filter((e) => e.kind === NOSTR_KIND_CELL_SNAPSHOT);
    assert.equal(snapshots.length, 2);
  });

  it('publishes at tick 0 (0 % 300 === 0)', () => {
    const pool = new SpyNostrPool();
    // biome-ignore lint/suspicious/noExplicitAny: spy pool for testing
    const pub = new NostrPublisher(pool as any, '2026-04-10', TEST_CONFIG);
    const cells = new Map<string, Cell>([[cellKey(5, 5), makeCell(0)]]);

    pub.onTick(0, cells, 'hash', new Uint8Array(32), 1);
    assert.equal(pool.published.length, 2); // snapshot + attestation
  });

  it('chain attestation includes correct stateHash and peerCount', () => {
    const pool = new SpyNostrPool();
    // biome-ignore lint/suspicious/noExplicitAny: spy pool for testing
    const pub = new NostrPublisher(pool as any, '2026-04-10', TEST_CONFIG);
    const cells = new Map<string, Cell>([[cellKey(5, 5), makeCell(300)]]);
    const chainHash = new Uint8Array(32).fill(0xab);

    pub.onTick(300, cells, 'my-state-hash', chainHash, 4);

    const attestation = pool.published.find((e) => e.kind === NOSTR_KIND_CHAIN_ATTESTATION);
    assert.ok(attestation);
    const shTag = attestation.tags.find((t) => t[0] === 'sh')?.[1];
    const peersTag = attestation.tags.find((t) => t[0] === 'peers')?.[1];
    assert.equal(shTag, 'my-state-hash');
    assert.equal(peersTag, '4');
  });

  it('publishWorldConfig after resetForNewDay uses new dayTag', () => {
    const pool = new SpyNostrPool();
    // biome-ignore lint/suspicious/noExplicitAny: spy pool for testing
    const pub = new NostrPublisher(pool as any, '2026-04-10', TEST_CONFIG);

    pub.resetForNewDay('2026-04-11');
    pub.publishWorldConfig(250, 250, 'cafe');

    const dTag = pool.published[0]?.tags.find((t) => t[0] === 'd')?.[1];
    assert.ok(dTag?.includes('2026-04-11'));
  });

  it('publishNow publishes regardless of cadence', () => {
    const pool = new SpyNostrPool();
    // biome-ignore lint/suspicious/noExplicitAny: spy pool for testing
    const pub = new NostrPublisher(pool as any, '2026-04-10', TEST_CONFIG);
    const cells = new Map<string, Cell>([[cellKey(5, 5), makeCell(137)]]);

    // Tick 137 is NOT a cadence tick — onTick would skip, publishNow should not
    pub.publishNow(137, cells, 'hash', new Uint8Array(32), 2);
    assert.equal(pool.published.length, 2); // snapshot + attestation
    assert.equal(pool.published[0]?.kind, NOSTR_KIND_CELL_SNAPSHOT);
    assert.equal(pool.published[1]?.kind, NOSTR_KIND_CHAIN_ATTESTATION);
  });

  it('publishNow with empty cells does nothing', () => {
    const pool = new SpyNostrPool();
    // biome-ignore lint/suspicious/noExplicitAny: spy pool for testing
    const pub = new NostrPublisher(pool as any, '2026-04-10', TEST_CONFIG);

    pub.publishNow(137, new Map(), 'hash', new Uint8Array(32), 1);
    assert.equal(pool.published.length, 0);
  });

  it('swallows publish errors without throwing', () => {
    const pool = {
      pubkey: 'test',
      async publish(): Promise<void> {
        throw new Error('relay down');
      },
    };
    // biome-ignore lint/suspicious/noExplicitAny: error-throwing pool for testing
    const pub = new NostrPublisher(pool as any, '2026-04-10', TEST_CONFIG);
    const cells = new Map<string, Cell>([[cellKey(5, 5), makeCell(300)]]);

    // Should not throw
    assert.doesNotThrow(() => {
      pub.onTick(300, cells, 'hash', new Uint8Array(32), 1);
    });
  });
});
