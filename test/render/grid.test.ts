// Behavioral tests for buildFrame. No escape-string snapshots; assertions describe
// what's at each cell after stripping ANSI escapes.

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { GLYPH_FLOOR, GLYPH_HEAD, GLYPH_TRAIL } from '../../src/render/constants.js';
import { type Viewport, buildFrame } from '../../src/render/grid.js';
import { type GridState, type Player, newRng } from '../../src/sim/index.js';
import { extractCells, stripAnsi } from './extract-cells.js';

const VIEWPORT: Viewport = { cols: 80, rows: 24 };

const cfg = { width: 8, height: 6, halfLifeTicks: 60, seed: 0n };

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
  return {
    tick: 0,
    config: cfg,
    rng: newRng(0n),
    players: new Map(),
    cells: new Map(),
  };
}

describe('buildFrame', () => {
  it('returns the right number of rows for the layout', () => {
    const rows = buildFrame(emptyState(), VIEWPORT, 'me@host');
    // top + height + bottom + status = 6 + 3 = 9
    assert.equal(rows.length, cfg.height + 3);
  });

  it('renders the box border on the first and last grid row', () => {
    const rows = buildFrame(emptyState(), VIEWPORT, 'me@host');
    const top = stripAnsi(rows[0] ?? '');
    assert.ok(top.startsWith('┌'));
    assert.ok(top.endsWith('┐'));
    const bottom = stripAnsi(rows[cfg.height + 1] ?? '');
    assert.ok(bottom.startsWith('└'));
    assert.ok(bottom.endsWith('┘'));
  });

  it('renders an empty interior as floor glyphs', () => {
    const rows = buildFrame(emptyState(), VIEWPORT, 'me@host');
    const cells = extractCells(rows);
    // Interior cells: x in [1..1+width), y in [1..1+height).
    for (let y = 1; y <= cfg.height; y++) {
      for (let x = 1; x <= cfg.width; x++) {
        assert.equal(cells[y]?.[x], GLYPH_FLOOR, `(${x},${y}) should be floor`);
      }
    }
  });

  it('renders a live player head at the right cell', () => {
    const s: GridState = {
      ...emptyState(),
      players: new Map([['me@host', makePlayer('me@host', 3, 2)]]),
    };
    const rows = buildFrame(s, VIEWPORT, 'me@host');
    const cells = extractCells(rows);
    // (3, 2) in grid coords → terminal column 3+1=4, terminal row 2+1=3.
    assert.equal(cells[3]?.[4], GLYPH_HEAD);
  });

  it('does not render a head for a dead player', () => {
    const s: GridState = {
      ...emptyState(),
      players: new Map([
        ['me@host', makePlayer('me@host', 3, 2, { isAlive: false, respawnAtTick: 30 })],
      ]),
    };
    const rows = buildFrame(s, VIEWPORT, 'me@host');
    const cells = extractCells(rows);
    // No head glyph anywhere in the interior.
    for (let y = 1; y <= cfg.height; y++) {
      for (let x = 1; x <= cfg.width; x++) {
        assert.notEqual(cells[y]?.[x], GLYPH_HEAD, `unexpected head at (${x},${y})`);
      }
    }
  });

  it('renders a fresh trail cell with the freshest glyph', () => {
    const cellAt = (x: number, y: number) =>
      `${y.toString(16).toUpperCase().padStart(4, '0')}${x.toString(16).toUpperCase().padStart(4, '0')}`;
    const s: GridState = {
      ...emptyState(),
      tick: 1,
      players: new Map([['me@host', makePlayer('me@host', 3, 2)]]),
      cells: new Map([[cellAt(2, 2), { type: 'trail', ownerId: 'me@host', createdAtTick: 1 }]]),
    };
    const rows = buildFrame(s, VIEWPORT, 'me@host');
    const cells = extractCells(rows);
    // Cell (2, 2) → terminal (3, 3). age = 0 → bucket 0 → freshest glyph.
    assert.equal(cells[3]?.[3], GLYPH_TRAIL[0]);
  });

  it('renders an aged trail cell with the middle bucket glyph', () => {
    const cellAt = (x: number, y: number) =>
      `${y.toString(16).toUpperCase().padStart(4, '0')}${x.toString(16).toUpperCase().padStart(4, '0')}`;
    // halfLife=60 → bucket boundaries at 30/60/90. age=60 = bucket 2.
    const s: GridState = {
      ...emptyState(),
      tick: 60,
      players: new Map([['me@host', makePlayer('me@host', 0, 0)]]),
      cells: new Map([[cellAt(4, 4), { type: 'trail', ownerId: 'me@host', createdAtTick: 0 }]]),
    };
    const rows = buildFrame(s, VIEWPORT, 'me@host');
    const cells = extractCells(rows);
    // Cell (4, 4) → terminal (5, 5).
    assert.equal(cells[5]?.[5], GLYPH_TRAIL[2]);
  });

  it('returns a single "terminal too small" row when the viewport is undersized', () => {
    const tinyViewport: Viewport = { cols: 4, rows: 4 };
    const rows = buildFrame(emptyState(), tinyViewport, 'me@host');
    assert.equal(rows.length, 1);
    assert.match(stripAnsi(rows[0] ?? ''), /terminal too small/i);
  });

  it('renders a status row containing tick, peers, and score markers', () => {
    const s: GridState = {
      ...emptyState(),
      tick: 42,
      players: new Map([['me@host', makePlayer('me@host', 1, 1, { score: 7 })]]),
    };
    const rows = buildFrame(s, VIEWPORT, 'me@host');
    const status = stripAnsi(rows[cfg.height + 2] ?? '');
    assert.match(status, /t=0042/);
    assert.match(status, /peers=1/);
    assert.match(status, /score=7/);
    assert.match(status, /alive=Y/);
  });
});
