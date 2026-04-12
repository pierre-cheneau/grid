import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { daemonColorSeed, daemonPlayerId } from '../../src/daemon/id.js';
import { parseMessage } from '../../src/net/protocol.js';

describe('daemonPlayerId', () => {
  it('produces bot.name@user.host format', () => {
    const id = daemonPlayerId('wallhugger', 'corne@thinkpad');
    assert.equal(id, 'bot.wallhugger@corne.thinkpad');
  });

  it('handles multi-part hostnames', () => {
    const id = daemonPlayerId('mybot', 'user@my-host');
    assert.equal(id, 'bot.mybot@user.my-host');
  });

  it('passes wire protocol ID validation', () => {
    const id = daemonPlayerId('wallhugger', 'corne@thinkpad');
    // This should not throw — the daemon ID must pass the wire protocol regex.
    const msg = parseMessage(
      JSON.stringify({
        v: 1,
        t: 'HELLO',
        from: id,
        color: [255, 0, 0],
        color_seed: 42,
        kind: 'daemon',
        client: 'grid/0.2.0',
        joined_at: 1000000,
      }),
    );
    assert.equal(msg.from, id);
  });

  it('daemon ID with various basenames passes validation', () => {
    for (const basename of ['test', 'wall-hugger', 'bot_v2', 'A.B']) {
      const id = daemonPlayerId(basename, 'u@h');
      assert.ok(/^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+$/.test(id), `ID failed regex: ${id}`);
    }
  });
});

describe('daemonColorSeed', () => {
  it('returns a u32', () => {
    const seed = daemonColorSeed('bot.test@user.host');
    assert.equal(typeof seed, 'number');
    assert.ok(seed >= 0);
    assert.ok(seed <= 0xffff_ffff);
  });

  it('is deterministic', () => {
    const a = daemonColorSeed('bot.test@user.host');
    const b = daemonColorSeed('bot.test@user.host');
    assert.equal(a, b);
  });

  it('produces different seeds for different IDs', () => {
    const a = daemonColorSeed('bot.alpha@u.h');
    const b = daemonColorSeed('bot.beta@u.h');
    assert.notEqual(a, b);
  });
});
