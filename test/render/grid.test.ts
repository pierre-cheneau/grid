// Behavioral tests for buildFrame with double-wide viewport camera model.
// Each world cell renders as 2 terminal characters wide.

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  GLYPH_FLOOR,
  GLYPH_HEAD,
  GLYPH_LOCAL_HEAD,
  GLYPH_TRAIL,
} from '../../src/render/constants.js';
import { type Camera, type Viewport, buildFrame } from '../../src/render/grid.js';
import { type GridState, type Player, cellKey, newRng } from '../../src/sim/index.js';
import { extractCells, stripAnsi } from './extract-cells.js';

const cfg = { width: 30, height: 20, halfLifeTicks: 60, seed: 0n, circular: false };

// 20 terminal cols = 10 world cells wide, 10 play rows + 1 status.
const VIEWPORT: Viewport = { cols: 20, rows: 11 };

function makePlayer(id: string, x: number, y: number, overrides: Partial<Player> = {}): Player {
  return {
    id,
    pos: { x, y },
    dir: 1,
    isAlive: true,
    respawnAtTick: null,
    score: 0,
    colorSeed: 0xdeadbeef,
    ...overrides,
  };
}

function emptyState(): GridState {
  return { tick: 0, config: cfg, rng: newRng(0n), players: new Map(), cells: new Map() };
}

// Camera centered in the world interior.
const CENTER: Camera = { x: 15, y: 10 };

describe('buildFrame (double-wide viewport)', () => {
  it('returns viewport.rows entries', () => {
    const rows = buildFrame(emptyState(), VIEWPORT, CENTER, 'me@host');
    assert.equal(rows.length, VIEWPORT.rows);
  });

  it('renders empty interior as doubled floor glyphs', () => {
    const rows = buildFrame(emptyState(), VIEWPORT, CENTER, 'me@host');
    const cells = extractCells(rows);
    // Every terminal character in the play area should be a floor glyph.
    for (let sy = 0; sy < VIEWPORT.rows - 1; sy++) {
      for (let sx = 0; sx < VIEWPORT.cols; sx++) {
        assert.equal(cells[sy]?.[sx], GLYPH_FLOOR, `(${sx},${sy}) should be floor`);
      }
    }
  });

  it('renders a player head as a double-wide block at screen center', () => {
    const s: GridState = {
      ...emptyState(),
      players: new Map([['me@host', makePlayer('me@host', CENTER.x, CENTER.y)]]),
    };
    const rows = buildFrame(s, VIEWPORT, CENTER, 'me@host');
    const cells = extractCells(rows);
    // Camera at CENTER, player at CENTER → head at screen center.
    // 10 world cells wide, center cell is index 5, at terminal cols 10-11.
    const viewCellsW = Math.floor(VIEWPORT.cols / 2);
    const screenCellX = Math.floor(viewCellsW / 2);
    const screenCellY = Math.floor((VIEWPORT.rows - 1) / 2);
    // Local player renders with composed directional arrow (dir=1 → East → ◥◢)
    const [gl, gr] = GLYPH_LOCAL_HEAD[1] ?? ['█', '█'];
    assert.equal(cells[screenCellY]?.[screenCellX * 2], gl, 'left half of head');
    assert.equal(cells[screenCellY]?.[screenCellX * 2 + 1], gr, 'right half of head');
  });

  it('does not render a head for a dead player', () => {
    const s: GridState = {
      ...emptyState(),
      players: new Map([
        [
          'me@host',
          makePlayer('me@host', CENTER.x, CENTER.y, { isAlive: false, respawnAtTick: 30 }),
        ],
      ]),
    };
    const rows = buildFrame(s, VIEWPORT, CENTER, 'me@host');
    const cells = extractCells(rows);
    for (let sy = 0; sy < VIEWPORT.rows - 1; sy++) {
      for (let sx = 0; sx < VIEWPORT.cols; sx++) {
        assert.notEqual(cells[sy]?.[sx], GLYPH_HEAD, `unexpected head at (${sx},${sy})`);
      }
    }
  });

  it('renders a trail cell as a double-wide glyph', () => {
    const s: GridState = {
      ...emptyState(),
      tick: 1,
      players: new Map([['me@host', makePlayer('me@host', CENTER.x, CENTER.y)]]),
      cells: new Map([
        [
          cellKey(CENTER.x - 1, CENTER.y),
          { type: 'trail', ownerId: 'me@host', createdAtTick: 1, colorSeed: 0xdead },
        ],
      ]),
    };
    const rows = buildFrame(s, VIEWPORT, CENTER, 'me@host');
    const cells = extractCells(rows);
    // Trail one cell left of center → 2 terminal chars left of screen center cell.
    const viewCellsW = Math.floor(VIEWPORT.cols / 2);
    const centerCell = Math.floor(viewCellsW / 2);
    const trailCell = centerCell - 1;
    const cy = Math.floor((VIEWPORT.rows - 1) / 2);
    assert.equal(cells[cy]?.[trailCell * 2], GLYPH_TRAIL[0], 'left half of trail');
    assert.equal(cells[cy]?.[trailCell * 2 + 1], GLYPH_TRAIL[0], 'right half of trail');
  });

  it('renders black void far outside the world boundary', () => {
    const smallCfg = { width: 4, height: 4, halfLifeTicks: 60, seed: 0n, circular: false };
    const smallState: GridState = { ...emptyState(), config: smallCfg };
    // Large viewport + camera far from world → corner is well past the derez ring
    const bigViewport: Viewport = { cols: 60, rows: 40 };
    const rows = buildFrame(smallState, bigViewport, { x: 2, y: 2 }, 'me@host');
    const cells = extractCells(rows);
    // Far corner of viewport — beyond the derez depth → pure void
    assert.equal(cells[0]?.[0], ' ', 'far outside world should be void');
  });

  it('renders a status row with tick and score', () => {
    const s: GridState = {
      ...emptyState(),
      tick: 42,
      players: new Map([['me@host', makePlayer('me@host', CENTER.x, CENTER.y, { score: 7 })]]),
    };
    const wideVp: Viewport = { cols: 80, rows: 11 };
    const rows = buildFrame(s, wideVp, CENTER, 'me@host');
    const status = stripAnsi(rows[wideVp.rows - 1] ?? '');
    assert.match(status, /t=0042/);
    assert.match(status, /score=7/);
  });

  it('shows recapText in status bar when provided', () => {
    const s: GridState = { ...emptyState(), tick: 1 };
    const wideVp: Viewport = { cols: 80, rows: 11 };
    const rows = buildFrame(s, wideVp, CENTER, 'me@host', undefined, 'Last Standing a@host (2m)');
    const status = stripAnsi(rows[wideVp.rows - 1] ?? '');
    assert.match(status, /Last Standing a@host/);
    assert.doesNotMatch(status, /t=0001/); // normal HUD replaced
  });
});
