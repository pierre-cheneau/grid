// Tests for the wire-protocol parser/encoder. This is the validation boundary, so the
// test surface is broad: every message type round-trips, and every reasonable malformed
// input is rejected with a ProtocolError.

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { ProtocolError } from '../../src/net/messages.js';
import type { Message } from '../../src/net/messages.js';
import { encodeMessage, parseMessage } from '../../src/net/protocol.js';

const SENDER = 'corne@thinkpad';

function rt(msg: Message): Message {
  return parseMessage(encodeMessage(msg), msg.from);
}

describe('parseMessage / encodeMessage round-trip', () => {
  it('HELLO', () => {
    const m: Message = {
      v: 1,
      t: 'HELLO',
      from: SENDER,
      color: [10, 200, 30],
      kind: 'pilot',
      client: 'grid/0.1.0',
      joined_at: 1700000000,
    };
    assert.deepEqual(rt(m), m);
  });

  it('INPUT', () => {
    const m: Message = { v: 1, t: 'INPUT', from: SENDER, tick: 42, i: 'L' };
    assert.deepEqual(rt(m), m);
  });

  it('STATE_HASH', () => {
    const m: Message = {
      v: 1,
      t: 'STATE_HASH',
      from: SENDER,
      tick: 30,
      h: '36f5919d650009ef',
    };
    assert.deepEqual(rt(m), m);
  });

  it('EVICT', () => {
    const m: Message = {
      v: 1,
      t: 'EVICT',
      from: SENDER,
      target: 'marie@archbox',
      reason: 'hash_mismatch',
      tick: 60,
    };
    assert.deepEqual(rt(m), m);
  });

  it('STATE_REQUEST', () => {
    const m: Message = { v: 1, t: 'STATE_REQUEST', from: SENDER };
    assert.deepEqual(rt(m), m);
  });

  it('STATE_RESPONSE', () => {
    const m: Message = {
      v: 1,
      t: 'STATE_RESPONSE',
      from: SENDER,
      to: 'newcomer@laptop',
      tick: 100,
      state_b64: 'R1JJRAEAAAAAAA==',
    };
    assert.deepEqual(rt(m), m);
  });

  it('KICKED', () => {
    const m: Message = {
      v: 1,
      t: 'KICKED',
      from: SENDER,
      to: 'marie@archbox',
      reason: 'timeout',
    };
    assert.deepEqual(rt(m), m);
  });

  it('BYE', () => {
    const m: Message = { v: 1, t: 'BYE', from: SENDER };
    assert.deepEqual(rt(m), m);
  });
});

describe('parseMessage rejects bad input', () => {
  const bad = (raw: string, sender = SENDER, re: RegExp = /ProtocolError/): void => {
    assert.throws(() => parseMessage(raw, sender), re);
  };

  it('rejects invalid JSON', () => bad('not json{'));
  it('rejects array top level', () => bad('[]'));
  it('rejects null top level', () => bad('null'));
  it('rejects unknown protocol version', () =>
    bad('{"v":2,"t":"BYE","from":"corne@thinkpad"}', SENDER, /protocol version/));
  it('rejects unknown type', () =>
    bad('{"v":1,"t":"GHOST","from":"corne@thinkpad"}', SENDER, /unknown message type/));
  it('rejects spoofed from', () =>
    bad('{"v":1,"t":"BYE","from":"corne@thinkpad"}', 'evil@box', /does not match sender/));
  it('rejects bad id format', () =>
    bad('{"v":1,"t":"BYE","from":"no_at_sign"}', 'no_at_sign', /not a valid id/));
  it('rejects INPUT with bad tick', () =>
    bad('{"v":1,"t":"INPUT","from":"corne@thinkpad","tick":-1,"i":""}', SENDER, /tick.*range/));
  it('rejects INPUT with bad turn', () =>
    bad('{"v":1,"t":"INPUT","from":"corne@thinkpad","tick":1,"i":"Z"}', SENDER, /invalid turn/));
  it('rejects STATE_HASH with wrong-length hash', () =>
    bad(
      '{"v":1,"t":"STATE_HASH","from":"corne@thinkpad","tick":30,"h":"abc"}',
      SENDER,
      /invalid hash/,
    ));
  it('rejects HELLO with bad color tuple', () =>
    bad(
      '{"v":1,"t":"HELLO","from":"corne@thinkpad","color":[1,2],"kind":"pilot","client":"grid","joined_at":1}',
      SENDER,
      /color must be a 3-tuple/,
    ));
  it('rejects EVICT with bad reason', () =>
    bad(
      '{"v":1,"t":"EVICT","from":"corne@thinkpad","target":"marie@archbox","reason":"because","tick":1}',
      SENDER,
      /invalid reason/,
    ));
  it('rejects oversized non-snapshot message', () => {
    const big = `{"v":1,"t":"BYE","from":"corne@thinkpad","x":"${'A'.repeat(20000)}"}`;
    bad(big, SENDER, /oversized message is not a snapshot/);
  });
  it('rejects STATE_RESPONSE with non-base64 payload', () =>
    bad(
      '{"v":1,"t":"STATE_RESPONSE","from":"corne@thinkpad","to":"newcomer@laptop","tick":1,"state_b64":"!!!"}',
      SENDER,
      /not base64/,
    ));
});

describe('ProtocolError', () => {
  it('is the thrown class', () => {
    try {
      parseMessage('not json', SENDER);
    } catch (e) {
      assert.ok(e instanceof ProtocolError);
      return;
    }
    assert.fail('expected throw');
  });
});
