// 24-bit color helpers for the renderer.
//
// Two responsibilities:
//   1. Derive a deterministic neon-bright RGB triple from a u32 colorSeed (the seed
//      is itself a hash of `${USER}@${HOSTNAME}` produced in `src/id/`).
//   2. Build the ANSI 24-bit foreground/background escape sequences for use inside
//      the frame builder.
//
// The neon-bias rule comes from `identity-and-aesthetic.md` line 12:
// "biased toward neon-bright colors (high saturation, high value) so trails are
// always vivid".
//
// We achieve this by deriving a hue (0..1) from the seed and converting from HSV
// with `s = 1`, `v = 1`. Pure float math, but the output is rounded to integer
// before any escape is built — the simulation never sees the float.

import { fnv1a32 } from '../id/hash.js';

/**
 * Deterministic 24-bit RGB triple for a colorSeed. The hue cycles through the full
 * spectrum so adjacent seeds get visibly distinct colors. Always neon-bright by
 * construction (`s = v = 1`).
 *
 * Same input → same output, on every platform, forever.
 */
// LRU-bounded cache for rgbFromColorSeed. In a 6-peer game, at most 6 unique
// seeds are active. The cache avoids re-running FNV + HSV on every cell every frame.
const rgbCache = new Map<number, readonly [number, number, number]>();
const RGB_CACHE_MAX = 32;

export function rgbFromColorSeed(seed: number): readonly [number, number, number] {
  const cached = rgbCache.get(seed);
  if (cached !== undefined) return cached;
  // Mix the seed once more so adjacent integer seeds (e.g. 0, 1, 2) don't produce
  // adjacent hues. Adjacent FNV outputs are still adjacent, but FNV of small ints
  // is itself well-spread.
  const mixed = fnv1a32(`color:${seed >>> 0}`);
  const hue = (mixed >>> 0) / 0x1_0000_0000; // [0, 1)
  const result = hsvToRgb(hue, 1, 1);
  // biome-ignore lint/style/noNonNullAssertion: cache is non-empty when size >= max
  if (rgbCache.size >= RGB_CACHE_MAX) rgbCache.delete(rgbCache.keys().next().value!);
  rgbCache.set(seed, result);
  return result;
}

/**
 * Linearly interpolate `rgb` toward black by `fraction` ∈ [0, 1].
 *
 * Used by the frame builder to fade trail cells as they age. The output is
 * integer-rounded so the resulting ANSI escape is platform-stable. The simulation
 * never sees this function.
 */
export function fadeColor(
  rgb: readonly [number, number, number],
  fraction: number,
): readonly [number, number, number] {
  const f = fraction <= 0 ? 0 : fraction >= 1 ? 1 : fraction;
  const k = 1 - f;
  return [Math.round(rgb[0] * k), Math.round(rgb[1] * k), Math.round(rgb[2] * k)];
}

/**
 * ANSI 24-bit foreground escape: `\x1b[38;2;R;G;Bm`. Pure string builder.
 * Caller is responsible for clamping `r`/`g`/`b` to `[0, 255]`.
 */
export function ansiFg(r: number, g: number, b: number): string {
  return `\x1b[38;2;${r};${g};${b}m`;
}

/**
 * ANSI 24-bit background escape: `\x1b[48;2;R;G;Bm`. Pure string builder.
 */
export function ansiBg(r: number, g: number, b: number): string {
  return `\x1b[48;2;${r};${g};${b}m`;
}

/**
 * Standard HSV → RGB conversion. Returns integer RGB in `[0, 255]`. The float math
 * is local to this helper; nothing leaks out.
 */
function hsvToRgb(h: number, s: number, v: number): readonly [number, number, number] {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  let r: number;
  let g: number;
  let b: number;
  switch (i % 6) {
    case 0:
      r = v;
      g = t;
      b = p;
      break;
    case 1:
      r = q;
      g = v;
      b = p;
      break;
    case 2:
      r = p;
      g = v;
      b = t;
      break;
    case 3:
      r = p;
      g = q;
      b = v;
      break;
    case 4:
      r = t;
      g = p;
      b = v;
      break;
    default:
      r = v;
      g = p;
      b = q;
      break;
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}
