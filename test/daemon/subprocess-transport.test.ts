import { strict as assert } from 'node:assert';
import { unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { createSubprocessTransport } from '../../src/daemon/subprocess-transport.js';

const ECHO_DAEMON = `
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.t === 'HELLO') {
    process.stdout.write(JSON.stringify({ t: 'HELLO_ACK', v: 1, name: 'echo', author: 'test', version: '0.1' }) + '\\n');
  } else if (msg.t === 'TICK') {
    process.stdout.write(JSON.stringify({ t: 'CMD', n: msg.n, i: '' }) + '\\n');
  }
});
`;

describe('SubprocessTransport', () => {
  const tmpFile = join(tmpdir(), `grid-test-daemon-${Date.now()}.js`);
  writeFileSync(tmpFile, ECHO_DAEMON);
  after(() => {
    try {
      unlinkSync(tmpFile);
    } catch {
      /* ignore */
    }
  });

  it('sends and receives JSON lines', async () => {
    const transport = createSubprocessTransport(tmpFile);
    const lines: string[] = [];
    transport.onLine((line) => lines.push(line));

    transport.send(
      JSON.stringify({
        t: 'HELLO',
        v: 1,
        you: 'bot.test@user.host',
        tick_ms: 100,
        config: { grid_w: 80, grid_h: 40 },
      }),
    );

    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (lines.length > 0) {
          clearInterval(check);
          resolve();
        }
      }, 10);
    });

    // biome-ignore lint/style/noNonNullAssertion: test — lines[0] is guaranteed by the await above
    const ack = JSON.parse(lines[0]!);
    assert.equal(ack.t, 'HELLO_ACK');
    assert.equal(ack.name, 'echo');

    transport.send(JSON.stringify({ t: 'TICK', n: 42 }));
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (lines.length >= 2) {
          clearInterval(check);
          resolve();
        }
      }, 10);
    });

    // biome-ignore lint/style/noNonNullAssertion: test — lines[1] is guaranteed by the await above
    const cmd = JSON.parse(lines[1]!);
    assert.equal(cmd.t, 'CMD');
    assert.equal(cmd.n, 42);
    assert.equal(cmd.i, '');

    transport.kill();
  });

  it('fires onExit when process exits', async () => {
    const exitScript = join(tmpdir(), `grid-test-exit-${Date.now()}.js`);
    writeFileSync(exitScript, 'process.exit(0);');
    const transport = createSubprocessTransport(exitScript);

    const exitCode = await new Promise<number | null>((resolve) => {
      transport.onExit((code) => resolve(code));
    });

    assert.equal(exitCode, 0);
    try {
      unlinkSync(exitScript);
    } catch {
      /* ignore */
    }
  });

  it('kill stops the subprocess', async () => {
    const transport = createSubprocessTransport(tmpFile);
    const exitPromise = new Promise<void>((resolve) => {
      transport.onExit(() => resolve());
    });
    transport.kill();
    await exitPromise;
  });
});
