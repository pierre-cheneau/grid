// The renderer's heart: pure projection from `GridState` to one ANSI-encoded
// string per terminal row.
//
// LAYOUT (when the viewport is large enough):
//   row 0:               top border    ┌─...─┐
//   rows 1..height:      play area     │ ... │
//   row height+1:        bottom border └─...─┘
//   row height+2:        status line   t=NNNN me=(x,y) dir=D peers=K alive=Y score=S hash=...
//
// If `viewport.cols < width + 2` or `viewport.rows < height + 3`, the function
// returns a single-row "terminal too small" message instead.
//
// Trail style: shaded blocks `█▓▒░` per `identity-and-aesthetic.md` §52, fading
// in color toward `#000000` per §60. The "continuous box-drawn lines" alternative
// in §40-46 is a polish-stage upgrade — see plan section "Deviations".
//
// Iteration: cells are positioned by `(x, y)` extracted from each cell key, so the
// iteration order of `state.cells.values()` is irrelevant. The renderer does not
// import `sortedEntries`; determinism is enforced inside `src/sim/`, not here.
//
// Pure: no I/O, no time, no env. The only allocations are the returned array of
// strings and the per-row string buffers.

import { type GridState, type Player, type PlayerId, type Tick, cellKey } from '../sim/index.js';
import { ageBucket, ageFraction } from './age.js';
import { RESET } from './ansi.js';
import { ansiBg, ansiFg, fadeColor, rgbFromColorSeed } from './color.js';
import {
  BOX_BOTTOM_LEFT,
  BOX_BOTTOM_RIGHT,
  BOX_HORIZONTAL,
  BOX_TOP_LEFT,
  BOX_TOP_RIGHT,
  BOX_VERTICAL,
  COLOR_FLOOR,
  COLOR_HUD,
  COLOR_WALL,
  FRAME_OVERHEAD_COLS,
  FRAME_OVERHEAD_ROWS,
  GLYPH_FLOOR,
  GLYPH_HEAD,
  GLYPH_TRAIL,
} from './constants.js';

export interface Viewport {
  readonly cols: number;
  readonly rows: number;
}

export function buildFrame(state: GridState, viewport: Viewport, localId: PlayerId): string[] {
  const w = state.config.width;
  const h = state.config.height;
  const needCols = w + FRAME_OVERHEAD_COLS;
  const needRows = h + FRAME_OVERHEAD_ROWS;
  if (viewport.cols < needCols || viewport.rows < needRows) {
    return [
      `terminal too small (need ${needCols}x${needRows}, have ${viewport.cols}x${viewport.rows})`,
    ];
  }

  const headByPos = indexLivePlayers(state);
  const wall = ansiFg(COLOR_WALL[0], COLOR_WALL[1], COLOR_WALL[2]);
  const floorBg = ansiBg(COLOR_FLOOR[0], COLOR_FLOOR[1], COLOR_FLOOR[2]);
  const hudFg = ansiFg(COLOR_HUD[0], COLOR_HUD[1], COLOR_HUD[2]);

  const rows: string[] = [];

  // Top border
  rows.push(floorBg + wall + BOX_TOP_LEFT + BOX_HORIZONTAL.repeat(w) + BOX_TOP_RIGHT + RESET);

  // Play rows
  for (let y = 0; y < h; y++) {
    rows.push(buildPlayRow(state, headByPos, y, w, floorBg, wall));
  }

  // Bottom border
  rows.push(floorBg + wall + BOX_BOTTOM_LEFT + BOX_HORIZONTAL.repeat(w) + BOX_BOTTOM_RIGHT + RESET);

  // Status row — uses the full viewport width since it sits below the frame.
  rows.push(buildStatusRow(state, localId, viewport.cols, floorBg, hudFg));

  return rows;
}

/** Build the live-player head index keyed by `"x,y"`. */
function indexLivePlayers(state: GridState): Map<string, Player> {
  const m = new Map<string, Player>();
  for (const p of state.players.values()) {
    if (p.isAlive) m.set(`${p.pos.x},${p.pos.y}`, p);
  }
  return m;
}

function buildPlayRow(
  state: GridState,
  headByPos: ReadonlyMap<string, Player>,
  y: number,
  w: number,
  floorBg: string,
  wall: string,
): string {
  let row = floorBg + wall + BOX_VERTICAL;
  for (let x = 0; x < w; x++) {
    row += cellGlyph(state, headByPos, x, y);
  }
  row += wall + BOX_VERTICAL + RESET;
  return row;
}

function cellGlyph(
  state: GridState,
  headByPos: ReadonlyMap<string, Player>,
  x: number,
  y: number,
): string {
  const head = headByPos.get(`${x},${y}`);
  if (head !== undefined) {
    const [r, g, b] = rgbFromColorSeed(head.colorSeed);
    return ansiFg(r, g, b) + GLYPH_HEAD;
  }
  const cell = state.cells.get(cellKey(x, y));
  if (cell !== undefined) {
    const age: Tick = state.tick - cell.createdAtTick;
    const bucket = ageBucket(age, state.config.halfLifeTicks);
    const owner = state.players.get(cell.ownerId);
    const seed = owner?.colorSeed ?? 0;
    const base = rgbFromColorSeed(seed);
    const faded = fadeColor(base, ageFraction(age, state.config.halfLifeTicks));
    return ansiFg(faded[0], faded[1], faded[2]) + GLYPH_TRAIL[bucket];
  }
  return GLYPH_FLOOR;
}

function buildStatusRow(
  state: GridState,
  localId: PlayerId,
  width: number,
  floorBg: string,
  hudFg: string,
): string {
  const me = state.players.get(localId);
  const tick = state.tick.toString().padStart(4, '0');
  const pos = me ? `(${me.pos.x},${me.pos.y})` : '(--)';
  const dir = me ? me.dir : '?';
  const alive = me?.isAlive ? 'Y' : 'N';
  const score = me?.score ?? 0;
  const peers = state.players.size;
  const text = `t=${tick} me=${pos} dir=${dir} peers=${peers} alive=${alive} score=${score}`;
  const padded =
    text.length >= width ? text.slice(0, width) : text + ' '.repeat(width - text.length);
  return floorBg + hudFg + padded + RESET;
}
