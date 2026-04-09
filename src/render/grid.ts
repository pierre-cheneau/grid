// The renderer's heart: pure projection from `GridState` to one ANSI-encoded
// string per terminal row.
//
// LAYOUT:
//   rows 0..viewH-1:     play area (viewport window into the world)
//   row viewH:           status line
//
// DOUBLE-WIDE RENDERING: each world cell occupies 2 terminal characters. This
// compensates for terminal characters being ~2x taller than wide, making:
//   - A square grid (60×60) look square on screen
//   - Movement speed look identical in all 4 directions (16px/tick everywhere)
//   - Crossing time symmetric (60 ticks in every direction for a 60×60 world)
//
// The viewport is a camera-centered window into the world. The camera follows
// the local player's cycle. Beyond the world boundary: black void.
//
// Pure: no I/O, no time, no env.

import {
  type GridState,
  type Player,
  type PlayerId,
  type Tick,
  cellKey,
  inBounds,
} from '../sim/index.js';
import { ageBucket, ageFraction } from './age.js';
import { RESET } from './ansi.js';
import { ansiBg, ansiFg, rgbFromColorSeed as cachedRgb, fadeColor } from './color.js';
import {
  COLOR_FLOOR,
  COLOR_HUD,
  COLOR_WALL,
  GLYPH_FLOOR,
  GLYPH_HEAD,
  GLYPH_LOCAL_HEAD,
  GLYPH_TRAIL,
} from './constants.js';
import { breathingDotColor } from './intro.js';

/** Characters per world cell horizontally. Compensates for the ~2:1 terminal
 *  character aspect ratio so movement looks uniform in all directions. */
const CELL_WIDTH = 2;

export interface Viewport {
  readonly cols: number;
  readonly rows: number;
}

export interface Camera {
  readonly x: number;
  readonly y: number;
}

export function buildFrame(
  state: GridState,
  viewport: Viewport,
  camera: Camera,
  localId: PlayerId,
  hash?: string,
  recapText?: string,
): string[] {
  const viewCellsW = Math.floor(viewport.cols / CELL_WIDTH);
  const viewH = viewport.rows - 1; // 1 row reserved for status

  const headByPos = indexLivePlayers(state);

  const floorBg = ansiBg(COLOR_FLOOR[0], COLOR_FLOOR[1], COLOR_FLOOR[2]);
  const hudFg = ansiFg(COLOR_HUD[0], COLOR_HUD[1], COLOR_HUD[2]);
  const floorDotRgb = breathingDotColor(state.tick, 20);
  const floorDotFg = ansiFg(floorDotRgb[0], floorDotRgb[1], floorDotRgb[2]);

  // Viewport origin in world coordinates.
  const halfW = Math.floor(viewCellsW / 2);
  const halfH = Math.floor(viewH / 2);
  const originX = camera.x - halfW;
  const originY = camera.y - halfH;

  const rows: string[] = [];

  // Play rows — each world cell emits CELL_WIDTH terminal characters.
  for (let sy = 0; sy < viewH; sy++) {
    rows.push(
      buildViewportRow(
        state,
        headByPos,
        originX,
        originY + sy,
        viewCellsW,
        floorBg,
        floorDotFg,
        viewport.cols,
        localId,
      ),
    );
  }

  // Status row — recap text overrides the normal HUD when present (e.g., after midnight).
  const statusText = recapText
    ? buildRecapRow(recapText, viewport.cols, floorDotFg, hudFg)
    : buildStatusRow(state, localId, viewport.cols, floorDotFg, hudFg, hash);
  rows.push(floorBg + statusText + RESET);

  return rows;
}

/** Build the live-player head index keyed by cellKey. */
function indexLivePlayers(state: GridState): Map<string, Player> {
  const m = new Map<string, Player>();
  for (const p of state.players.values()) {
    if (p.isAlive) m.set(cellKey(p.pos.x, p.pos.y), p);
  }
  return m;
}

/** How many cells deep the derez effect extends beyond the world boundary. */
const DEREZ_DEPTH = 10;

/** Cycling block characters for the animated derez edge. */
const DEREZ_CHARS = '░▒▓█▓▒';

/**
 * For a void cell, returns 0..1 indicating proximity to the world boundary.
 * 1 = immediately adjacent, fading to 0 at DEREZ_DEPTH cells out.
 * Returns 0 for cells deep in the void (no effect).
 */
function derezIntensity(cfg: GridState['config'], wx: number, wy: number): number {
  if (cfg.circular) {
    const dx = 2 * wx - (cfg.width - 1);
    const dy = 2 * wy - (cfg.height - 1);
    const d = Math.min(cfg.width, cfg.height);
    const distSq = dx * dx + dy * dy;
    const rSq = d * d;
    if (distSq <= rSq) return 0; // inside world (shouldn't happen for void cells)
    // Approximate cell distance beyond boundary: sqrt(distSq)/d - 1, scaled
    const ratio = Math.sqrt(distSq) / d;
    const cellsBeyond = (ratio - 1) * d * 0.5;
    if (cellsBeyond >= DEREZ_DEPTH) return 0;
    return 1 - cellsBeyond / DEREZ_DEPTH;
  }
  // Rectangular: distance to nearest edge
  let dist = Number.MAX_SAFE_INTEGER;
  if (wx < 0) dist = Math.min(dist, -wx);
  if (wy < 0) dist = Math.min(dist, -wy);
  if (wx >= cfg.width) dist = Math.min(dist, wx - cfg.width + 1);
  if (wy >= cfg.height) dist = Math.min(dist, wy - cfg.height + 1);
  if (dist > DEREZ_DEPTH) return 0;
  return 1 - (dist - 1) / DEREZ_DEPTH;
}

/** Build a single viewport row. Each world cell emits CELL_WIDTH (2) terminal
 *  characters. Escape-minimized: only emits a new ansiFg when the color changes. */
function buildViewportRow(
  state: GridState,
  headByPos: ReadonlyMap<string, Player>,
  originX: number,
  worldY: number,
  viewCellsW: number,
  floorBg: string,
  floorFg: string,
  termCols: number,
  localId: PlayerId,
): string {
  let row = floorBg;
  let lastFg = '';
  let charsEmitted = 0;

  for (let cx = 0; cx < viewCellsW; cx++) {
    const wx = originX + cx;
    const inWorld = inBounds(state.config, wx, worldY);

    if (inWorld) {
      // Check for player head
      const key = cellKey(wx, worldY);
      const head = headByPos.get(key);
      if (head !== undefined) {
        const rgb = cachedRgb(head.colorSeed);
        const fg = ansiFg(rgb[0], rgb[1], rgb[2]);
        if (fg !== lastFg) {
          row += fg;
          lastFg = fg;
        }
        if (head.id === localId) {
          const [gl, gr] = GLYPH_LOCAL_HEAD[head.dir] ?? ['█', '█'];
          row += gl + gr;
        } else {
          row += GLYPH_HEAD.repeat(CELL_WIDTH);
        }
        charsEmitted += CELL_WIDTH;
        continue;
      }

      // Check for trail cell (reuse key from head lookup)
      const cell = state.cells.get(key);
      if (cell !== undefined) {
        const age: Tick = state.tick - cell.createdAtTick;
        const bucket = ageBucket(age, state.config.halfLifeTicks);
        const base = cachedRgb(cell.colorSeed);
        const faded = fadeColor(base, ageFraction(age, state.config.halfLifeTicks));
        const fg = ansiFg(faded[0], faded[1], faded[2]);
        if (fg !== lastFg) {
          row += fg;
          lastFg = fg;
        }
        row += GLYPH_TRAIL[bucket].repeat(CELL_WIDTH);
        charsEmitted += CELL_WIDTH;
        continue;
      }

      // Empty floor: breathing dots
      if (lastFg !== floorFg) {
        row += floorFg;
        lastFg = floorFg;
      }
      row += GLYPH_FLOOR.repeat(CELL_WIDTH);
      charsEmitted += CELL_WIDTH;
      continue;
    }

    // Outside the world: animated derez edge near the boundary, black void beyond.
    const derez = derezIntensity(state.config, wx, worldY);
    if (derez > 0) {
      const speed = 1 + derez * 4; // faster shimmer near the edge
      const idx =
        (((Math.floor(state.tick * speed) + wx * 7 + worldY * 13) % DEREZ_CHARS.length) +
          DEREZ_CHARS.length) %
        DEREZ_CHARS.length;
      const ch = DEREZ_CHARS[idx] ?? '░';
      // Pulse amplitude is stronger near the edge (frantic), gentler further out.
      const pulse = 0.5 + 0.5 * Math.abs(Math.sin((state.tick * speed + wx * 3 + worldY) * 0.15));
      // Color gradient: hot white-cyan at the border → dim cyan at outer edge.
      // A minimum glow ensures the derez ring is always visible against the void.
      const hot = derez * derez; // quadratic — stays bright near edge, drops fast
      const minGlow = 0.12; // outer edge never fades below this
      const intensity = minGlow + (1 - minGlow) * derez;
      const r = Math.round(60 * hot * pulse * intensity);
      const g = Math.round((COLOR_WALL[1] * 0.3 + 255 * 0.7 * hot) * pulse * intensity);
      const b = Math.round((COLOR_WALL[2] * 0.3 + 255 * 0.7 * hot) * pulse * intensity);
      const fg = ansiFg(r, g, b);
      if (fg !== lastFg) {
        row += fg;
        lastFg = fg;
      }
      row += ch.repeat(CELL_WIDTH);
    } else {
      row += '  ';
      lastFg = '';
    }
    charsEmitted += CELL_WIDTH;
  }

  // Fill remaining terminal columns if viewport.cols is odd.
  while (charsEmitted < termCols) {
    row += ' ';
    charsEmitted++;
  }

  row += RESET;
  return row;
}

function buildRecapRow(text: string, width: number, dotFg: string, hudFg: string): string {
  if (text.length >= width) return hudFg + text.slice(0, width);
  const leftPad = Math.floor((width - text.length) / 2);
  const rightPad = width - text.length - leftPad;
  return dotFg + '.'.repeat(leftPad) + hudFg + text + dotFg + '.'.repeat(rightPad);
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
  return dotFg + '.'.repeat(leftPad) + hudFg + text + dotFg + '.'.repeat(rightPad);
}
