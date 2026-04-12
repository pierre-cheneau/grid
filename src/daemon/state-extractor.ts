// Extract a DaemonTick message from GridState for a given daemon player.
//
// Pure function, no I/O. Used by DaemonBridge to build the per-tick state
// snapshot sent to the daemon process.

import { parseCellKey } from '../sim/grid.js';
import type { GridState, PlayerId } from '../sim/types.js';
import type { DaemonCell, DaemonOther, DaemonSelf, DaemonTick } from './types.js';

const DIR_NAMES = ['N', 'E', 'S', 'W'] as const;

export function extractDaemonTick(state: GridState, daemonId: PlayerId): DaemonTick {
  const me = state.players.get(daemonId);
  const you: DaemonSelf = me
    ? {
        x: me.pos.x,
        y: me.pos.y,
        dir: DIR_NAMES[me.dir],
        alive: me.isAlive,
        score: me.score,
      }
    : { x: 0, y: 0, dir: 'N', alive: false, score: 0 };

  const others: DaemonOther[] = [];
  for (const p of state.players.values()) {
    if (p.id === daemonId || !p.isAlive) continue;
    others.push({
      id: p.id,
      x: p.pos.x,
      y: p.pos.y,
      dir: DIR_NAMES[p.dir],
      alive: true,
    });
  }

  const cells: DaemonCell[] = [];
  for (const [key, cell] of state.cells) {
    const { x, y } = parseCellKey(key);
    cells.push({
      x,
      y,
      type: cell.type,
      owner: cell.ownerId,
      age: state.tick - cell.createdAtTick,
    });
  }

  return { t: 'TICK', n: state.tick, you, others, cells };
}
