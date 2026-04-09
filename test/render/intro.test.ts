// Behavioral tests for the 8-phase intro animation.

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { GLYPH_HEAD } from '../../src/render/constants.js';
import { INTRO_DURATION_MS, type IntroConfig, introFrame } from '../../src/render/intro.js';
import { stripAnsi } from './extract-cells.js';

const cfg: IntroConfig = {
  cols: 60,
  rows: 20,
  identity: 'corne@thinkpad',
  spawnX: 10,
  spawnY: 6,
  gridW: 30,
  gridH: 14,
  identityColor: [0, 255, 200],
};

describe('introFrame', () => {
  it('returns config.rows entries at t=0', () => {
    assert.equal(introFrame(cfg, 0, 42).length, cfg.rows);
  });

  it('shows cursor prompt during Phase 1 (t=500)', () => {
    const text = introFrame(cfg, 500, 42).map(stripAnsi).join('');
    assert.ok(text.includes('>'), 'cursor prompt should be visible');
  });

  it('shows identity characters during typing Phase 2 (t=2000)', () => {
    const text = introFrame(cfg, 2000, 42).map(stripAnsi).join('');
    assert.ok(text.includes('corne'), 'typed identity should be visible');
  });

  it('shows dots through the vortex void (late vortex phase)', () => {
    // At 80% through the vortex, the eye is large and dots are visible.
    const vortexLate = 5500 + (10500 - 5500) * 0.8;
    const text = introFrame(cfg, vortexLate, 42).map(stripAnsi).join('');
    assert.ok(text.includes('.'), 'dot grid should be visible through the void');
  });

  it('shows grid border during construction Phase 6', () => {
    const text = introFrame(cfg, 10000, 42).map(stripAnsi).join('');
    assert.ok(text.includes('┌') || text.includes('─'), 'grid border should be drawing');
  });

  it('shows head glyph at end of animation', () => {
    const frame = introFrame(cfg, INTRO_DURATION_MS, 42);
    // The spawn is at grid coords inside the centered grid frame.
    const gx = Math.floor((cfg.cols - (cfg.gridW + 2)) / 2);
    const gy = Math.floor((cfg.rows - (cfg.gridH + 3)) / 2);
    const screenX = gx + 1 + cfg.spawnX;
    const screenY = gy + 1 + cfg.spawnY;
    const text = stripAnsi(frame[screenY] ?? '');
    assert.equal(text[screenX], GLYPH_HEAD, 'head glyph at spawn position');
  });

  it('shows hidden message when seed % 100 === 0 (during pause phase)', () => {
    const text = introFrame(cfg, 3000, 100).map(stripAnsi).join('');
    const hasMessage =
      text.includes('end of line') ||
      text.includes('i fight for the users') ||
      text.includes('greetings program') ||
      text.includes('digital frontier') ||
      text.includes('derezzed') ||
      text.includes('not play alone');
    assert.ok(hasMessage, 'hidden message should appear');
  });

  it('generates each frame in under 5ms', () => {
    const start = performance.now();
    const step = 50;
    for (let t = 0; t < INTRO_DURATION_MS; t += step) introFrame(cfg, t, 42);
    const frames = Math.ceil(INTRO_DURATION_MS / step);
    const perFrame = (performance.now() - start) / frames;
    assert.ok(perFrame < 5, `frame took ${perFrame.toFixed(2)}ms (budget: 5ms)`);
  });
});
