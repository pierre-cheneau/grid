import { strict as assert } from 'node:assert';
import { unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { DAEMON_MAX_SOURCE_BYTES } from '../../src/daemon/constants.js';
import { runSandbox } from '../../src/daemon/forge/sandbox.js';

// A valid daemon that goes straight (simplest possible).
const GOOD_DAEMON = `
const rl = require('readline').createInterface({ input: process.stdin });
const s = m => process.stdout.write(JSON.stringify(m) + '\\n');
let h = false;
rl.on('line', l => {
  const m = JSON.parse(l);
  if (!h) { s({ t: 'HELLO_ACK', v: 1, name: 'good', author: 'test', version: '0.1' }); h = true; return; }
  s({ t: 'CMD', n: m.n, i: '' });
});
`;

// A daemon that crashes immediately after handshake.
const CRASH_DAEMON = `
const rl = require('readline').createInterface({ input: process.stdin });
const s = m => process.stdout.write(JSON.stringify(m) + '\\n');
rl.on('line', l => {
  const m = JSON.parse(l);
  if (m.t === 'HELLO') { s({ t: 'HELLO_ACK', v: 1, name: 'crash', author: 'test', version: '0.1' }); return; }
  process.exit(1);
});
`;

// A daemon that never responds to HELLO.
const NO_HANDSHAKE_DAEMON = `
// intentionally does nothing
`;

describe('Sandbox', () => {
  const goodFile = join(tmpdir(), `grid-sandbox-good-${Date.now()}.js`);
  const crashFile = join(tmpdir(), `grid-sandbox-crash-${Date.now()}.js`);
  const noHsFile = join(tmpdir(), `grid-sandbox-nohs-${Date.now()}.js`);
  const bigFile = join(tmpdir(), `grid-sandbox-big-${Date.now()}.js`);

  writeFileSync(goodFile, GOOD_DAEMON);
  writeFileSync(crashFile, CRASH_DAEMON);
  writeFileSync(noHsFile, NO_HANDSHAKE_DAEMON);
  writeFileSync(bigFile, 'x'.repeat(DAEMON_MAX_SOURCE_BYTES + 100));

  after(() => {
    for (const f of [goodFile, crashFile, noHsFile, bigFile]) {
      try {
        unlinkSync(f);
      } catch {
        /* ignore */
      }
    }
  });

  it('passes for a valid daemon', async () => {
    const result = await runSandbox(goodFile);
    assert.ok(result.passed, `expected pass, got error: ${result.error}`);
    assert.ok(result.ticks > 0);
    assert.ok(result.survivalTicks >= 30);
    assert.ok(result.byteCount > 0);
    assert.ok(result.byteCount <= DAEMON_MAX_SOURCE_BYTES);
  });

  it('fails for a crashing daemon', async () => {
    const result = await runSandbox(crashFile);
    assert.ok(!result.passed);
    assert.ok(result.error !== undefined);
  });

  it('fails for handshake timeout daemon', async () => {
    const result = await runSandbox(noHsFile);
    assert.ok(!result.passed);
    assert.ok(result.error?.includes('handshake'));
  });

  it('fails for oversized source', async () => {
    const result = await runSandbox(bigFile);
    assert.ok(!result.passed);
    assert.ok(result.error?.includes('bytes'));
    assert.equal(result.ticks, 0);
  });

  it('reports byte count correctly', async () => {
    const result = await runSandbox(goodFile);
    const expected = Buffer.byteLength(GOOD_DAEMON.replace(/\r\n/g, '\n'), 'utf-8');
    assert.equal(result.byteCount, expected);
  });
});
