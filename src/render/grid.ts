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
import { ansiBg, ansiFg, rgbFromColorSeed as cachedRgb, fadeColor } from './color.js';
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
import { breathingDotColor } from './intro.js';

export interface Viewport {
  readonly cols: number;
  readonly rows: number;
}

export function buildFrame(
  state: GridState,
  viewport: Viewport,
  localId: PlayerId,
  hash?: string,
): string[] {
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

  // Living floor: breathing dots. Period of 20 ticks = 2 seconds at 10 tps,
  // matching the intro animation's ~2s breathing rhythm.
  const floorDotRgb = breathingDotColor(state.tick, 20);
  const floorDotFg = ansiFg(floorDotRgb[0], floorDotRgb[1], floorDotRgb[2]);

  // Center the grid when the viewport is larger than the frame.
  const padX = Math.max(0, Math.floor((viewport.cols - needCols) / 2));
  const padY = Math.max(0, Math.floor((viewport.rows - needRows) / 2));

  // Breathing dots fill ALL areas outside the grid — the world extends beyond
  // the arena borders. One color escape per row (same optimization as the intro).
  const dotPad = (n: number) => (n > 0 ? '.'.repeat(n) : '');
  const hPadL = dotPad(padX);
  const hPadR = dotPad(Math.max(0, viewport.cols - padX - needCols));
  const dotRow = floorBg + floorDotFg + '.'.repeat(viewport.cols) + RESET;

  const rows: string[] = [];

  // Top vertical padding — breathing dots
  for (let i = 0; i < padY; i++) rows.push(dotRow);

  // Top border
  rows.push(
    floorBg +
      floorDotFg +
      hPadL +
      wall +
      BOX_TOP_LEFT +
      BOX_HORIZONTAL.repeat(w) +
      BOX_TOP_RIGHT +
      floorDotFg +
      hPadR +
      RESET,
  );

  // Play rows
  for (let y = 0; y < h; y++) {
    rows.push(
      floorBg +
        floorDotFg +
        hPadL +
        buildPlayRow(state, headByPos, y, w, floorBg, wall, floorDotFg) +
        floorDotFg +
        hPadR +
        RESET,
    );
  }

  // Bottom border
  rows.push(
    floorBg +
      floorDotFg +
      hPadL +
      wall +
      BOX_BOTTOM_LEFT +
      BOX_HORIZONTAL.repeat(w) +
      BOX_BOTTOM_RIGHT +
      floorDotFg +
      hPadR +
      RESET,
  );

  // Status row: centered text, dot-padded to fill the full viewport.
  const statusText = buildStatusRow(state, localId, viewport.cols, floorDotFg, hudFg, hash);
  rows.push(floorBg + statusText + RESET);

  // Bottom vertical padding — breathing dots
  for (let i = rows.length; i < viewport.rows; i++) rows.push(dotRow);

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

/** Build a play row with minimal escape sequences. Only emits a new ansiFg when
 *  the color changes from the previous cell — the same optimization that makes
 *  the intro animation smooth on Windows conhost (microsoft/terminal#10362). */
function buildPlayRow(
  state: GridState,
  headByPos: ReadonlyMap<string, Player>,
  y: number,
  w: number,
  floorBg: string,
  wall: string,
  floorFg: string,
): string {
  let row = floorBg + wall + BOX_VERTICAL;
  let lastFg = '';
  for (let x = 0; x < w; x++) {
    const head = headByPos.get(`${x},${y}`);
    if (head !== undefined) {
      const rgb = cachedRgb(head.colorSeed);
      const fg = ansiFg(rgb[0], rgb[1], rgb[2]);
      if (fg !== lastFg) {
        row += fg;
        lastFg = fg;
      }
      row += GLYPH_HEAD;
      continue;
    }
    const cell = state.cells.get(cellKey(x, y));
    if (cell !== undefined) {
      const age: Tick = state.tick - cell.createdAtTick;
      const bucket = ageBucket(age, state.config.halfLifeTicks);
      const seed = state.players.get(cell.ownerId)?.colorSeed ?? 0;
      const base = cachedRgb(seed);
      const faded = fadeColor(base, ageFraction(age, state.config.halfLifeTicks));
      const fg = ansiFg(faded[0], faded[1], faded[2]);
      if (fg !== lastFg) {
        row += fg;
        lastFg = fg;
      }
      row += GLYPH_TRAIL[bucket];
      continue;
    }
    // Living floor: breathing dot. Only re-emit the color if it changed.
    if (lastFg !== floorFg) {
      row += floorFg;
      lastFg = floorFg;
    }
    row += GLYPH_FLOOR;
  }
  row += wall + BOX_VERTICAL;
  return row;
}

function buildStatusRow(
  state: GridState,
  localId: PlayerId,
  width: number,
  dotFg: string,
  hudFg: string,
  hash?: string,
): string {
  const me = state.players.get(localId);
  const tick = state.tick.toString().padStart(4, '0');
  const pos = me ? `(${me.pos.x},${me.pos.y})` : '(--)';
  const dir = me ? me.dir : '?';
  const alive = me?.isAlive ? 'Y' : 'N';
  const score = me?.score ?? 0;
  const peers = state.players.size;
  const text = `t=${tick} me=${pos} dir=${dir} peers=${peers} alive=${alive} score=${score}${hash ? ` hash=${hash}` : ''}`;
  if (text.length >= width) return hudFg + text.slice(0, width);
  const leftPad = Math.floor((width - text.length) / 2);
  const rightPad = width - text.length - leftPad;
  // Dot-filled padding so the breathing grid extends through the status row.
  return dotFg + '.'.repeat(leftPad) + hudFg + text + dotFg + '.'.repeat(rightPad);
}
