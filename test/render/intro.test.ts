// Behavioral tests for the intro animation (grid-draw phase removed in Stage 6).

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { GLYPH_HEAD } from '../../src/render/constants.js';
import { INTRO_DURATION_MS, type IntroConfig, introFrame } from '../../src/render/intro.js';
import { stripAnsi } from './extract-cells.js';

const cfg: IntroConfig = {
  cols: 60,
  rows: 20,
  identity: 'corne@thinkpad',
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
    const vortexLate = 5500 + (10500 - 5500) * 0.8;
    const text = introFrame(cfg, vortexLate, 42).map(stripAnsi).join('');
    assert.ok(text.includes('.'), 'dot grid should be visible through the void');
  });

  it('shows double-wide head glyph at screen center near end of animation', () => {
    const frame = introFrame(cfg, INTRO_DURATION_MS, 42);
    // Spawn is double-wide at screen center.
    const sx = Math.floor(cfg.cols / 2) - 1;
    const sy = Math.floor(cfg.rows / 2);
    const text = stripAnsi(frame[sy] ?? '');
    assert.equal(text[sx], GLYPH_HEAD, 'left half of head');
    assert.equal(text[sx + 1], GLYPH_HEAD, 'right half of head');
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
