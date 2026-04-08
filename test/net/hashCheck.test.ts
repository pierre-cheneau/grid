import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { HashCheck } from '../../src/net/hashCheck.js';
import type { StateHashMsg } from '../../src/net/messages.js';

const mk = (from: string, h: string, tick = 30): StateHashMsg => ({
  v: 1,
  t: 'STATE_HASH',
  from,
  tick,
  h,
});

describe('HashCheck', () => {
  it('isCadenceTick recognizes multiples of 30', () => {
    assert.equal(HashCheck.isCadenceTick(30), true);
    assert.equal(HashCheck.isCadenceTick(60), true);
    assert.equal(HashCheck.isCadenceTick(0), false);
    assert.equal(HashCheck.isCadenceTick(31), false);
  });

  it('returns null when fewer than 2 peers have reported', () => {
    const c = new HashCheck();
    c.recordOwn(30, 'aaaaaaaaaaaaaaaa', 'p:a');
    assert.equal(c.classify(30), null);
  });

  it('returns null when all peers agree', () => {
    const c = new HashCheck();
    c.recordOwn(30, 'aaaaaaaaaaaaaaaa', 'p:a');
    c.recordRemote(mk('p:b', 'aaaaaaaaaaaaaaaa'));
    c.recordRemote(mk('p:c', 'aaaaaaaaaaaaaaaa'));
    assert.equal(c.classify(30), null);
  });

  it('flags the minority peer in a 3-peer disagree scenario', () => {
    const c = new HashCheck();
    c.recordOwn(30, 'aaaaaaaaaaaaaaaa', 'p:a');
    c.recordRemote(mk('p:b', 'aaaaaaaaaaaaaaaa'));
    c.recordRemote(mk('p:c', 'bbbbbbbbbbbbbbbb'));
    const d = c.classify(30);
    assert.ok(d);
    assert.equal(d.tick, 30);
    assert.deepEqual(d.minority, ['p:c']);
    assert.equal(d.majorityHash, 'aaaaaaaaaaaaaaaa');
  });
});
