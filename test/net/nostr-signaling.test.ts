import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { NOSTR_KIND_SIGNALING } from '../../src/net/nostr-events.js';
import {
  type SignalingMessage,
  buildSignalingEvent,
  isInitiator,
  parseSignalingMessage,
} from '../../src/net/nostr-signaling.js';

const PEER_A = 'aaaa1111';
const PEER_B = 'bbbb2222';

describe('buildSignalingEvent', () => {
  it('produces correct kind and p tag', () => {
    const evt = buildSignalingEvent(PEER_B, { t: 'offer', sdp: 'v=0...' });
    assert.equal(evt.kind, NOSTR_KIND_SIGNALING);
    assert.deepEqual(evt.tags, [['p', PEER_B]]);
  });

  it('JSON-encodes offer in content', () => {
    const evt = buildSignalingEvent(PEER_B, { t: 'offer', sdp: 'v=0...' });
    const parsed = JSON.parse(evt.content);
    assert.equal(parsed.t, 'offer');
    assert.equal(parsed.sdp, 'v=0...');
  });

  it('JSON-encodes answer in content', () => {
    const evt = buildSignalingEvent(PEER_B, { t: 'answer', sdp: 'v=0 a' });
    const parsed = JSON.parse(evt.content);
    assert.equal(parsed.t, 'answer');
    assert.equal(parsed.sdp, 'v=0 a');
  });

  it('JSON-encodes ice candidate in content', () => {
    const evt = buildSignalingEvent(PEER_B, {
      t: 'ice',
      candidate: 'candidate:1 1 udp 1 1.2.3.4 1234 typ host',
      mid: '0',
    });
    const parsed = JSON.parse(evt.content);
    assert.equal(parsed.t, 'ice');
    assert.equal(parsed.candidate, 'candidate:1 1 udp 1 1.2.3.4 1234 typ host');
    assert.equal(parsed.mid, '0');
  });

  it('uses unix seconds for created_at', () => {
    const evt = buildSignalingEvent(PEER_B, { t: 'offer', sdp: '' }, 1700000000000);
    assert.equal(evt.created_at, 1700000000);
  });
});

describe('parseSignalingMessage', () => {
  it('parses offer', () => {
    const msg = parseSignalingMessage('{"t":"offer","sdp":"v=0..."}');
    assert.deepEqual(msg, { t: 'offer', sdp: 'v=0...' });
  });

  it('parses answer', () => {
    const msg = parseSignalingMessage('{"t":"answer","sdp":"v=0 a"}');
    assert.deepEqual(msg, { t: 'answer', sdp: 'v=0 a' });
  });

  it('parses ice', () => {
    const msg = parseSignalingMessage('{"t":"ice","candidate":"cand","mid":"0"}');
    assert.deepEqual(msg, { t: 'ice', candidate: 'cand', mid: '0' });
  });

  it('returns null on malformed JSON', () => {
    assert.equal(parseSignalingMessage('not json'), null);
    assert.equal(parseSignalingMessage(''), null);
    assert.equal(parseSignalingMessage('{'), null);
  });

  it('returns null on missing t field', () => {
    assert.equal(parseSignalingMessage('{"sdp":"v=0"}'), null);
  });

  it('returns null on unknown t value', () => {
    assert.equal(parseSignalingMessage('{"t":"unknown","sdp":"v=0"}'), null);
  });

  it('returns null on missing sdp for offer', () => {
    assert.equal(parseSignalingMessage('{"t":"offer"}'), null);
  });

  it('returns null on missing sdp for answer', () => {
    assert.equal(parseSignalingMessage('{"t":"answer"}'), null);
  });

  it('returns null on missing candidate for ice', () => {
    assert.equal(parseSignalingMessage('{"t":"ice","mid":"0"}'), null);
  });

  it('returns null on missing mid for ice', () => {
    assert.equal(parseSignalingMessage('{"t":"ice","candidate":"cand"}'), null);
  });

  it('returns null on non-string sdp', () => {
    assert.equal(parseSignalingMessage('{"t":"offer","sdp":42}'), null);
  });

  it('returns null on null content', () => {
    assert.equal(parseSignalingMessage('null'), null);
  });

  it('returns null on JSON string literal', () => {
    assert.equal(parseSignalingMessage('"hello"'), null);
  });

  it('returns null on JSON number literal', () => {
    assert.equal(parseSignalingMessage('42'), null);
  });

  it('returns null on JSON array', () => {
    // Arrays are typeof object but fail the message shape check
    assert.equal(parseSignalingMessage('[]'), null);
    assert.equal(parseSignalingMessage('[{"t":"offer","sdp":"v=0"}]'), null);
  });

  it('returns null on non-string candidate for ice', () => {
    assert.equal(parseSignalingMessage('{"t":"ice","candidate":42,"mid":"0"}'), null);
  });

  it('returns null on non-string mid for ice', () => {
    assert.equal(parseSignalingMessage('{"t":"ice","candidate":"c","mid":0}'), null);
  });
});

describe('buildSignalingEvent default now', () => {
  it('uses Date.now() when now parameter is omitted', () => {
    const before = Math.floor(Date.now() / 1000);
    const evt = buildSignalingEvent(PEER_B, { t: 'offer', sdp: '' });
    const after = Math.floor(Date.now() / 1000);
    assert.ok(evt.created_at >= before);
    assert.ok(evt.created_at <= after);
  });
});

describe('roundtrip build → parse', () => {
  const cases: SignalingMessage[] = [
    { t: 'offer', sdp: 'v=0\r\no=- 1 2 IN IP4 1.2.3.4\r\n' },
    { t: 'answer', sdp: 'v=0\r\no=- 3 4 IN IP4 5.6.7.8\r\n' },
    { t: 'ice', candidate: 'candidate:1 1 udp 1 1.2.3.4 1234 typ host', mid: '0' },
    { t: 'ice', candidate: '', mid: '' }, // edge case: empty strings
  ];
  for (const msg of cases) {
    it(`roundtrips ${msg.t}`, () => {
      const evt = buildSignalingEvent(PEER_B, msg);
      const parsed = parseSignalingMessage(evt.content);
      assert.deepEqual(parsed, msg);
    });
  }
});

describe('isInitiator', () => {
  it('returns true when my pubkey is lex-lower', () => {
    assert.equal(isInitiator(PEER_A, PEER_B), true);
  });

  it('returns false when my pubkey is lex-higher', () => {
    assert.equal(isInitiator(PEER_B, PEER_A), false);
  });

  it('is asymmetric — both peers cannot be initiators', () => {
    assert.notEqual(isInitiator(PEER_A, PEER_B), isInitiator(PEER_B, PEER_A));
  });

  it('handles real-looking 64-char hex pubkeys', () => {
    const lower = '0000000000000000000000000000000000000000000000000000000000000001';
    const higher = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
    assert.equal(isInitiator(lower, higher), true);
    assert.equal(isInitiator(higher, lower), false);
  });
});
