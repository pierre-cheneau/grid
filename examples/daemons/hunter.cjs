#!/usr/bin/env node
// hunter — chases the nearest opponent. Falls back to danger avoidance.
// Deploy: npx grid --deploy ./examples/daemons/hunter.cjs

const rl = require('node:readline').createInterface({ input: process.stdin });
const send = (m) => process.stdout.write(`${JSON.stringify(m)}\n`);
const D = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
const L = { N: 'W', W: 'S', S: 'E', E: 'N' };
const R = { N: 'E', E: 'S', S: 'W', W: 'N' };
let h = false;

function isSafe(x, y, danger) {
  return !danger.has(`${x},${y}`);
}

function bestMove(me, others, danger) {
  const dirs = [
    ['', me.dir],
    ['L', L[me.dir]],
    ['R', R[me.dir]],
  ];
  // Filter to safe moves
  const safe = dirs.filter(([, d]) => {
    const [dx, dy] = D[d];
    return isSafe(me.x + dx, me.y + dy, danger);
  });
  if (safe.length === 0) return '';
  // If opponents visible, pick the move that gets closest to nearest
  if (others.length > 0) {
    const nearest = others.reduce(
      (best, o) => {
        const dist = Math.abs(o.x - me.x) + Math.abs(o.y - me.y);
        return dist < best.dist ? { o, dist } : best;
      },
      { o: others[0], dist: Number.POSITIVE_INFINITY },
    );
    const target = nearest.o;
    let bestCmd = safe[0][0];
    let bestDist = Number.POSITIVE_INFINITY;
    for (const [cmd, d] of safe) {
      const [dx, dy] = D[d];
      const nx = me.x + dx;
      const ny = me.y + dy;
      const dist = Math.abs(target.x - nx) + Math.abs(target.y - ny);
      if (dist < bestDist) {
        bestDist = dist;
        bestCmd = cmd;
      }
    }
    return bestCmd;
  }
  return safe[0][0]; // no opponents: go straight if safe
}

rl.on('line', (l) => {
  const m = JSON.parse(l);
  if (!h) {
    send({ t: 'HELLO_ACK', v: 1, name: 'hunter', author: 'grid', version: '0.1' });
    h = true;
    return;
  }
  if (m.t !== 'TICK' || !m.you.alive) {
    send({ t: 'CMD', n: m.n, i: '' });
    return;
  }
  const danger = new Set(m.cells.map((c) => `${c.x},${c.y}`));
  send({ t: 'CMD', n: m.n, i: bestMove(m.you, m.others, danger) });
});
