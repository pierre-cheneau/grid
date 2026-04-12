#!/usr/bin/env node
// right-turner — a daemon that turns right whenever something is ahead.
// Deploy: npx grid --deploy ./examples/daemons/right-turner.cjs

const readline = require('node:readline');
const rl = readline.createInterface({ input: process.stdin });
const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);

const DELTAS = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
let handshakeDone = false;

rl.on('line', (line) => {
  const msg = JSON.parse(line);
  if (!handshakeDone) {
    send({ t: 'HELLO_ACK', v: 1, name: 'right-turner', author: 'grid', version: '0.1' });
    handshakeDone = true;
    return;
  }
  if (msg.t !== 'TICK' || !msg.you.alive) {
    send({ t: 'CMD', n: msg.n, i: '' });
    return;
  }
  const [dx, dy] = DELTAS[msg.you.dir];
  const fx = msg.you.x + dx;
  const fy = msg.you.y + dy;
  const danger = new Set(msg.cells.map((c) => `${c.x},${c.y}`));
  send({ t: 'CMD', n: msg.n, i: danger.has(`${fx},${fy}`) ? 'R' : '' });
});
