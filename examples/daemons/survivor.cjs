#!/usr/bin/env node
// survivor — flood-fill lookahead picks the direction with the most open space.
// Avoids trails, walls, and dead ends. Hunts opponents when safe. Competitive
// for Last Standing (survival) and Architect (territory coverage).
// Deploy: npx grid --deploy ./examples/daemons/survivor.cjs

const rl = require('node:readline').createInterface({ input: process.stdin });
const send = (m) => process.stdout.write(`${JSON.stringify(m)}\n`);

const D = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
const L = { N: 'W', W: 'S', S: 'E', E: 'N' };
const R = { N: 'E', E: 'S', S: 'W', W: 'N' };
let hs = false;
let gw = 250;
let gh = 250;

function flood(sx, sy, danger, limit) {
  let count = 0;
  const seen = new Set();
  const q = [[sx, sy]];
  while (q.length > 0 && count < limit) {
    const [x, y] = q.shift();
    const k = `${x},${y}`;
    if (seen.has(k)) continue;
    if (x < 0 || y < 0 || x >= gw || y >= gh) continue;
    if (danger.has(k)) continue;
    seen.add(k);
    count++;
    q.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  return count;
}

rl.on('line', (line) => {
  const m = JSON.parse(line);
  if (!hs) {
    send({ t: 'HELLO_ACK', v: 1, name: 'survivor', author: 'grid', version: '0.1' });
    hs = true;
    if (m.config) { gw = m.config.grid_w || 250; gh = m.config.grid_h || 250; }
    return;
  }
  if (m.t !== 'TICK' || !m.you.alive) {
    send({ t: 'CMD', n: m.n, i: '' });
    return;
  }

  const me = m.you;
  const danger = new Set(m.cells.map((c) => `${c.x},${c.y}`));

  // Also mark opponent positions and their immediate forward cell as danger
  for (const o of m.others) {
    danger.add(`${o.x},${o.y}`);
    if (D[o.dir]) {
      const [dx, dy] = D[o.dir];
      danger.add(`${o.x + dx},${o.y + dy}`);
    }
  }

  // Evaluate all three options: straight, left, right
  const options = [
    { cmd: '', dir: me.dir },
    { cmd: 'L', dir: L[me.dir] },
    { cmd: 'R', dir: R[me.dir] },
  ];

  let best = '';
  let bestScore = -1;

  for (const opt of options) {
    const [dx, dy] = D[opt.dir];
    const nx = me.x + dx;
    const ny = me.y + dy;
    const nk = `${nx},${ny}`;

    // Immediate danger — skip
    if (danger.has(nk) || nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;

    // Flood-fill from the target cell to measure open space (cap at 80)
    const space = flood(nx, ny, danger, 80);

    // Bonus: prefer directions toward nearest opponent (hunting)
    let huntBonus = 0;
    if (m.others.length > 0 && space > 30) {
      const nearest = m.others.reduce((b, o) => {
        const d = Math.abs(o.x - me.x) + Math.abs(o.y - me.y);
        return d < b.d ? { o, d } : b;
      }, { o: m.others[0], d: Infinity });
      const distNow = Math.abs(nearest.o.x - me.x) + Math.abs(nearest.o.y - me.y);
      const distAfter = Math.abs(nearest.o.x - nx) + Math.abs(nearest.o.y - ny);
      if (distAfter < distNow) huntBonus = 5;
    }

    const score = space + huntBonus;
    if (score > bestScore) {
      bestScore = score;
      best = opt.cmd;
    }
  }

  send({ t: 'CMD', n: m.n, i: best });
});
