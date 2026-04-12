import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { parseCmd, parseHelloAck } from '../../src/daemon/validate.js';

describe('parseHelloAck', () => {
  it('parses a valid HELLO_ACK', () => {
    const raw = JSON.stringify({
      t: 'HELLO_ACK',
      v: 1,
      name: 'wallhugger',
      author: 'corne',
      version: '0.1',
    });
    const ack = parseHelloAck(raw);
    assert.ok(ack);
    assert.equal(ack.t, 'HELLO_ACK');
    assert.equal(ack.name, 'wallhugger');
    assert.equal(ack.author, 'corne');
    assert.equal(ack.version, '0.1');
  });

  it('returns null on malformed JSON', () => {
    assert.equal(parseHelloAck('{not json'), null);
  });

  it('returns null on wrong type', () => {
    assert.equal(
      parseHelloAck(JSON.stringify({ t: 'CMD', v: 1, name: 'x', author: 'y', version: '1' })),
      null,
    );
  });

  it('returns null on wrong version', () => {
    assert.equal(
      parseHelloAck(JSON.stringify({ t: 'HELLO_ACK', v: 2, name: 'x', author: 'y', version: '1' })),
      null,
    );
  });

  it('returns null on missing name', () => {
    assert.equal(
      parseHelloAck(JSON.stringify({ t: 'HELLO_ACK', v: 1, author: 'y', version: '1' })),
      null,
    );
  });

  it('returns null on empty name', () => {
    assert.equal(
      parseHelloAck(JSON.stringify({ t: 'HELLO_ACK', v: 1, name: '', author: 'y', version: '1' })),
      null,
    );
  });

  it('returns null on non-object', () => {
    assert.equal(parseHelloAck('"hello"'), null);
    assert.equal(parseHelloAck('42'), null);
    assert.equal(parseHelloAck('null'), null);
  });
});

describe('parseCmd', () => {
  it('parses valid CMD with empty input', () => {
    const cmd = parseCmd(JSON.stringify({ t: 'CMD', n: 100, i: '' }), 100);
    assert.ok(cmd);
    assert.equal(cmd.n, 100);
    assert.equal(cmd.i, '');
  });

  it('parses valid CMD with L turn', () => {
    const cmd = parseCmd(JSON.stringify({ t: 'CMD', n: 50, i: 'L' }), 50);
    assert.ok(cmd);
    assert.equal(cmd.i, 'L');
  });

  it('parses valid CMD with R turn', () => {
    const cmd = parseCmd(JSON.stringify({ t: 'CMD', n: 50, i: 'R' }), 50);
    assert.ok(cmd);
    assert.equal(cmd.i, 'R');
  });

  it('parses valid CMD with X exit', () => {
    const cmd = parseCmd(JSON.stringify({ t: 'CMD', n: 50, i: 'X' }), 50);
    assert.ok(cmd);
    assert.equal(cmd.i, 'X');
  });

  it('returns null on wrong tick', () => {
    assert.equal(parseCmd(JSON.stringify({ t: 'CMD', n: 100, i: '' }), 101), null);
  });

  it('returns null on malformed JSON', () => {
    assert.equal(parseCmd('{nope', 0), null);
  });

  it('returns null on wrong type', () => {
    assert.equal(parseCmd(JSON.stringify({ t: 'TICK', n: 0, i: '' }), 0), null);
  });

  it('returns null on invalid turn', () => {
    assert.equal(parseCmd(JSON.stringify({ t: 'CMD', n: 0, i: 'U' }), 0), null);
  });

  it('returns null on missing i field', () => {
    assert.equal(parseCmd(JSON.stringify({ t: 'CMD', n: 0 }), 0), null);
  });

  it('returns null on non-object', () => {
    assert.equal(parseCmd('42', 0), null);
  });
});
