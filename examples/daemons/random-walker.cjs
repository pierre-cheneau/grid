#!/usr/bin/env node
// random-walker — turns randomly with 15% probability per tick.
// Simple but effective in sparse grids. Deploy: npx grid --deploy ./examples/daemons/random-walker.cjs

const rl = require('node:readline').createInterface({ input: process.stdin });
const send = (m) => process.stdout.write(`${JSON.stringify(m)}\n`);
let h = false;
rl.on('line', (l) => {
  const m = JSON.parse(l);
  if (!h) {
    send({ t: 'HELLO_ACK', v: 1, name: 'random-walker', author: 'grid', version: '0.1' });
    h = true;
    return;
  }
  if (m.t !== 'TICK' || !m.you.alive) {
    send({ t: 'CMD', n: m.n, i: '' });
    return;
  }
  const r = Math.random();
  send({ t: 'CMD', n: m.n, i: r < 0.075 ? 'L' : r < 0.15 ? 'R' : '' });
});
