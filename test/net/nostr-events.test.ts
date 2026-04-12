// Tests for GRID-specific Nostr event builders.

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { finalizeEvent, generateSecretKey, verifyEvent } from 'nostr-tools/pure';
import {
  NOSTR_KIND_CELL_SNAPSHOT,
  NOSTR_KIND_CHAIN_ATTESTATION,
  NOSTR_KIND_PRESENCE,
  NOSTR_KIND_WORLD_CONFIG,
  buildCellSnapshotEvent,
  buildChainAttestationEvent,
  buildPresenceEvent,
  buildWorldConfigEvent,
} from '../../src/net/nostr-events.js';

function findTag(tags: string[][], name: string): string | undefined {
  return tags.find((t) => t[0] === name)?.[1];
}

describe('buildWorldConfigEvent', () => {
  it('produces correct kind and tags', () => {
    const evt = buildWorldConfigEvent('2026-04-09', 632, 316, 'abc123');
    assert.equal(evt.kind, NOSTR_KIND_WORLD_CONFIG);
    assert.equal(findTag(evt.tags, 'd'), 'grid:2026-04-09');
    assert.equal(findTag(evt.tags, 'w'), '632');
    assert.equal(findTag(evt.tags, 'h'), '316');
    assert.equal(findTag(evt.tags, 'seed'), 'abc123');
    assert.ok(evt.created_at > 0);
  });

  it('includes peak tag when provided', () => {
    const evt = buildWorldConfigEvent('2026-04-09', 250, 250, 'seed', undefined, 42);
    assert.equal(findTag(evt.tags, 'peak'), '42');
  });

  it('omits peak tag when undefined', () => {
    const evt = buildWorldConfigEvent('2026-04-09', 250, 250, 'seed');
    assert.equal(findTag(evt.tags, 'peak'), undefined);
  });

  it('includes relay tags when provided', () => {
    const evt = buildWorldConfigEvent('2026-04-09', 250, 250, 'seed', undefined, undefined, [
      { tileRange: '0-3,0-3', relayUrl: 'wss://relay1.example.com' },
      { tileRange: '4-7,0-3', relayUrl: 'wss://relay2.example.com' },
    ]);
    const relayTags = evt.tags.filter((t) => t[0] === 'relay');
    assert.equal(relayTags.length, 2);
    assert.equal(relayTags[0]?.[1], '0-3,0-3');
    assert.equal(relayTags[0]?.[2], 'wss://relay1.example.com');
    assert.equal(relayTags[1]?.[1], '4-7,0-3');
  });

  it('backward compat: no peak or relay produces minimal event', () => {
    const evt = buildWorldConfigEvent('2026-04-09', 250, 250, 'seed');
    // Only 4 tags: d, w, h, seed
    assert.equal(evt.tags.length, 4);
  });
});

describe('buildCellSnapshotEvent', () => {
  it('produces correct kind and base64 content', () => {
    const cells = new Uint8Array([1, 2, 3, 4, 5]);
    const evt = buildCellSnapshotEvent('2026-04-09', 3, 7, 54000, cells);
    assert.equal(evt.kind, NOSTR_KIND_CELL_SNAPSHOT);
    assert.equal(findTag(evt.tags, 'd'), 'grid:2026-04-09:t:3-7');
    assert.equal(findTag(evt.tags, 'tick'), '54000');
    // Content is base64-encoded
    const decoded = Buffer.from(evt.content, 'base64');
    assert.deepEqual(new Uint8Array(decoded), cells);
  });
});

describe('buildChainAttestationEvent', () => {
  it('produces correct kind and tags', () => {
    const chainHash = new Uint8Array(32).fill(0xab);
    const evt = buildChainAttestationEvent('2026-04-09', 600, 'a3f8c92b', chainHash, 3);
    assert.equal(evt.kind, NOSTR_KIND_CHAIN_ATTESTATION);
    assert.equal(findTag(evt.tags, 'd'), 'grid:2026-04-09');
    assert.equal(findTag(evt.tags, 'tick'), '600');
    assert.equal(findTag(evt.tags, 'sh'), 'a3f8c92b');
    assert.equal(findTag(evt.tags, 'ch'), 'ab'.repeat(32));
    assert.equal(findTag(evt.tags, 'peers'), '3');
  });
});

describe('buildPresenceEvent', () => {
  it('produces correct kind and position tags', () => {
    const evt = buildPresenceEvent('2026-04-09', 3, 7, 890, 1820, 1, 'corne@thinkpad');
    assert.equal(evt.kind, NOSTR_KIND_PRESENCE);
    assert.equal(findTag(evt.tags, 'd'), 'grid:2026-04-09:p:3-7');
    assert.equal(findTag(evt.tags, 'pos'), '890,1820');
    assert.equal(findTag(evt.tags, 'dir'), '1');
    assert.equal(findTag(evt.tags, 'pid'), 'corne@thinkpad');
  });
});

describe('buildPresenceEvent', () => {
  it('produces correct kind and position tags', () => {
    const evt = buildPresenceEvent('2026-04-09', 3, 7, 890, 1820, 1, 'corne@thinkpad');
    assert.equal(evt.kind, NOSTR_KIND_PRESENCE);
    assert.equal(findTag(evt.tags, 'd'), 'grid:2026-04-09:p:3-7');
    assert.equal(findTag(evt.tags, 'pos'), '890,1820');
    assert.equal(findTag(evt.tags, 'dir'), '1');
    assert.equal(findTag(evt.tags, 'pid'), 'corne@thinkpad');
  });
});

describe('edge cases', () => {
  it('cell snapshot with empty compressed cells', () => {
    const evt = buildCellSnapshotEvent('2026-04-09', 0, 0, 0, new Uint8Array(0));
    assert.equal(evt.content, '');
    assert.equal(findTag(evt.tags, 'tick'), '0');
  });

  it('cell snapshot with large tick value (near u32 max)', () => {
    const evt = buildCellSnapshotEvent('2026-04-09', 0, 0, 4294967295, new Uint8Array([1]));
    assert.equal(findTag(evt.tags, 'tick'), '4294967295');
  });

  it('chain attestation with zero peer count', () => {
    const evt = buildChainAttestationEvent('2026-04-09', 0, '', new Uint8Array(32), 0);
    assert.equal(findTag(evt.tags, 'peers'), '0');
  });
});

describe('event roundtrip (build → sign → verify)', () => {
  it('world config event survives signing', () => {
    const sk = generateSecretKey();
    const template = buildWorldConfigEvent('2026-04-09', 250, 250, 'deadbeef');
    const signed = finalizeEvent(template, sk);
    assert.equal(verifyEvent(signed), true);
  });

  it('cell snapshot event survives signing', () => {
    const sk = generateSecretKey();
    const template = buildCellSnapshotEvent('2026-04-09', 0, 0, 1000, new Uint8Array([9, 8, 7]));
    const signed = finalizeEvent(template, sk);
    assert.equal(verifyEvent(signed), true);
  });

  it('chain attestation event survives signing', () => {
    const sk = generateSecretKey();
    const template = buildChainAttestationEvent(
      '2026-04-09',
      300,
      'ff00ff00',
      new Uint8Array(32),
      2,
    );
    const signed = finalizeEvent(template, sk);
    assert.equal(verifyEvent(signed), true);
  });

  it('presence event survives signing', () => {
    const sk = generateSecretKey();
    const template = buildPresenceEvent('2026-04-09', 0, 0, 50, 25, 2, 'test@host');
    const signed = finalizeEvent(template, sk);
    assert.equal(verifyEvent(signed), true);
  });
});
