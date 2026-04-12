#!/usr/bin/env node
// spiral — expanding spiral pattern. Turns right every N ticks, increasing N each cycle.
// Deploy: npx grid --deploy ./examples/daemons/spiral.cjs

const rl = require('node:readline').createInterface({ input: process.stdin });
const send = (m) => process.stdout.write(`${JSON.stringify(m)}\n`);
const D = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
let h = false;
let count = 0;
let leg = 4;
rl.on('line', (l) => {
  const m = JSON.parse(l);
  if (!h) {
    send({ t: 'HELLO_ACK', v: 1, name: 'spiral', author: 'grid', version: '0.1' });
    h = true;
    return;
  }
  if (m.t !== 'TICK' || !m.you.alive) {
    send({ t: 'CMD', n: m.n, i: '' });
    return;
  }
  count++;
  // Check for danger ahead and turn if needed
  const [dx, dy] = D[m.you.dir];
  const fx = m.you.x + dx;
  const fy = m.you.y + dy;
  const danger = new Set(m.cells.map((c) => `${c.x},${c.y}`));
  if (danger.has(`${fx},${fy}`)) {
    count = 0;
    leg = Math.max(4, leg - 1);
    send({ t: 'CMD', n: m.n, i: 'R' });
    return;
  }
  // Spiral: turn right every `leg` ticks, then grow the leg
  if (count >= leg) {
    count = 0;
    leg++;
    send({ t: 'CMD', n: m.n, i: 'R' });
    return;
  }
  send({ t: 'CMD', n: m.n, i: '' });
});
