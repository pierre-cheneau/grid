// Color helper tests. Pin known outputs for known inputs and assert the neon-bias
// invariant holds for many seeds. The ANSI escape strings are exact constants.

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { ansiBg, ansiFg, fadeColor, rgbFromColorSeed } from '../../src/render/color.js';

describe('rgbFromColorSeed', () => {
  it('is deterministic for a fixed seed', () => {
    assert.deepEqual(rgbFromColorSeed(0), rgbFromColorSeed(0));
    assert.deepEqual(rgbFromColorSeed(0xdeadbeef), rgbFromColorSeed(0xdeadbeef));
  });

  it('returns distinct colors for adjacent seeds', () => {
    const a = rgbFromColorSeed(0);
    const b = rgbFromColorSeed(1);
    assert.notDeepEqual(a, b);
  });

  it('always returns a neon-bright color (max channel >= 200)', () => {
    for (let s = 0; s < 100; s++) {
      const [r, g, b] = rgbFromColorSeed(s);
      const max = Math.max(r, g, b);
      assert.ok(max >= 200, `seed=${s} → (${r},${g},${b}) max=${max}`);
    }
  });

  it('always returns components in [0, 255]', () => {
    for (let s = 0; s < 100; s++) {
      const [r, g, b] = rgbFromColorSeed(s);
      for (const c of [r, g, b]) {
        assert.ok(c >= 0 && c <= 255, `out-of-range: ${c}`);
      }
    }
  });
});

describe('fadeColor', () => {
  it('returns the original color at fraction 0', () => {
    assert.deepEqual(fadeColor([255, 0, 0], 0), [255, 0, 0]);
  });

  it('returns black at fraction 1', () => {
    assert.deepEqual(fadeColor([255, 128, 64], 1), [0, 0, 0]);
  });

  it('returns half-intensity at fraction 0.5', () => {
    assert.deepEqual(fadeColor([200, 100, 50], 0.5), [100, 50, 25]);
  });

  it('clamps fraction below 0 to 0', () => {
    assert.deepEqual(fadeColor([100, 100, 100], -1), [100, 100, 100]);
  });

  it('clamps fraction above 1 to 1', () => {
    assert.deepEqual(fadeColor([100, 100, 100], 2), [0, 0, 0]);
  });
});

describe('ansiFg / ansiBg', () => {
  it('builds the foreground escape', () => {
    assert.equal(ansiFg(255, 0, 0), '\x1b[38;2;255;0;0m');
    assert.equal(ansiFg(0, 255, 200), '\x1b[38;2;0;255;200m');
  });

  it('builds the background escape', () => {
    assert.equal(ansiBg(0x0a, 0x0a, 0x1a), '\x1b[48;2;10;10;26m');
  });
});
