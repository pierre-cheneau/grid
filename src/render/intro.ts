// The digitization intro — the threshold between the outside world and the grid.
//
// 8-phase cinematic sequence (~8 seconds):
//   Phase 1 (0–1500ms):        CURSOR BLINK — >_ centered, blinking
//   Phase 2 (1500–2500ms):     TYPING — >USER@HOSTNAME types itself out
//   Phase 3 (2500–3500ms):     PAUSE — dramatic beat, cursor blinks
//   Phase 4 (3500–5500ms):     VORTEX — characters spiral outward, void expands,
//                              dot-pulse grid revealed through the void
//   Phase 5 (5500–6500ms):     DOT GRID BREATHES — full screen, "you're inside"
//   Phase 6 (6500–7500ms):     GRID CONSTRUCTS — box border draws itself
//   Phase 7 (7500–8000ms):     CYCLE SPAWNS — █ materializes, orange→identity color
//   Phase 8 (8000ms+):         PLAY — control transfers
//
// Performance: sparse overlay + minimal escape sequences. <5ms/frame on 230×60.

import { RESET, moveTo } from './ansi.js';
import { ansiBg, ansiFg } from './color.js';
import { COLOR_FLOOR, COLOR_INTRO, COLOR_WALL, GLYPH_HEAD, HIDDEN_MESSAGES } from './constants.js';
import type { AnsiWriter } from './writer.js';

export const INTRO_DURATION_MS = 11000;

const FRAME_INTERVAL_MS = 50; // ~20fps

// Phase timing (ms). No grid-draw phase — the vortex opens directly onto the
// world, and the cycle spawns at screen center.
const CURSOR_END = 1500;
const TYPING_START = 1500;
const TYPING_END = 2500;
const VORTEX_START = 5500; // after the 3s dramatic pause
const VORTEX_END = 10500; // 5s for the tornado
const SPAWN_START = 9500; // overlaps with vortex exit
const SPAWN_END = 10500;

export interface IntroConfig {
  readonly cols: number;
  readonly rows: number;
  readonly identity: string;
  readonly identityColor: readonly [number, number, number];
}

/** A particle in the tornado vortex. Starts at the typed text position,
 *  forms into a ring, then the ring expands outward. */
interface TornadoParticle {
  readonly char: string;
  readonly originX: number; // where the char was in the typed text
  readonly originY: number;
  readonly angle0: number; // target angle on the initial ring
  readonly angularV: number; // radians per second (orbit speed)
  readonly radialV: number; // cells per second (expansion speed)
}

/** Time within Phase 4 for characters to move from text to ring formation. */
const FORMATION_MS = 500;

function initTornado(config: IntroConfig, seed: number): TornadoParticle[] {
  const prompt = `>${config.identity}`;
  const cx = Math.floor(config.cols / 2);
  const cy = Math.floor(config.rows / 2);
  const promptX = cx - Math.floor(prompt.length / 2);
  const particles: TornadoParticle[] = [];
  const baseInitRadius = Math.max(4, Math.min(config.cols, config.rows) * 0.12);
  // Particle count scales with screen AREA so density feels consistent on any
  // terminal — from 80×24 (~100 particles) to 230×60 (~700 particles).
  const screenArea = config.cols * config.rows;
  const count = Math.max(80, Math.floor(screenArea * 0.12));
  for (let i = 0; i < count; i++) {
    // Each particle is a copy of a character from the typed prompt.
    const srcIdx = i % prompt.length;
    const char = prompt[srcIdx] ?? '.';
    const originX = promptX + srcIdx;
    const originY = cy;
    // Evenly distributed target angles on the initial ring.
    const angle0 = (i / count) * Math.PI * 2 + ((seed & 0xff) / 255) * Math.PI;
    const angularV = 2.0 + ((i * 37 + seed) & 0xff) / 300; // 2.0–2.9 rad/s
    // Radial velocity scaled to screen size: the SLOWEST particle must exit
    // the screen by VORTEX_END. This ensures the tornado fills and leaves
    // any screen — from a small 80×24 to a maximized 1440p terminal.
    const screenDiag =
      Math.sqrt((config.cols / 2) ** 2 + (config.rows * 0.45) ** 2) + baseInitRadius + 5;
    const expansionSecs = (VORTEX_END - VORTEX_START - FORMATION_MS) / 1000;
    const minV = screenDiag / expansionSecs;
    const radialV = minV * (1 + ((i * 53 + seed) & 0xff) / 400); // 1x–1.6x spread
    particles.push({ char, originX, originY, angle0, angularV, radialV });
  }
  return particles;
}

function lerp(a: number, b: number, f: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, f));
}

function easeInOut(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c < 0.5 ? 4 * c * c * c : 1 - (-2 * c + 2) ** 3 / 2;
}

/** Breathing dot color for both intro and gameplay. Exported so grid.ts can reuse. */
export function breathingDotColor(tick: number, period: number): readonly [number, number, number] {
  const pulse = 0.5 + 0.5 * Math.sin((tick / period) * Math.PI);
  return [Math.round(25 + 30 * pulse), Math.round(25 + 30 * pulse), Math.round(40 + 40 * pulse)];
}

/**
 * Pure frame generator for the 8-phase intro sequence.
 */
export function introFrame(
  config: IntroConfig,
  t: number,
  seed: number,
  vortexChars?: ReadonlyArray<TornadoParticle>,
): string[] {
  const { cols, rows } = config;
  const floorBg = ansiBg(COLOR_FLOOR[0], COLOR_FLOOR[1], COLOR_FLOOR[2]);
  const cx = Math.floor(cols / 2);
  const cy = Math.floor(rows / 2);
  const overlay = new Map<string, string>();

  // Dot grid: visible from vortex phase onward, breathing throughout.
  const showDots = t >= VORTEX_START;
  const dotRgb = breathingDotColor(t, 1000);
  const dotFg = ansiFg(dotRgb[0], dotRgb[1], dotRgb[2]);

  // The tornado's eye radius: starts at 0, grows as the spinning ring expands.
  // The dot grid is ONLY visible inside this radius — creating the "falling into
  // the grid" effect as the eye opens. After the vortex, the full screen is dots.
  const maxRadius = Math.sqrt(cx * cx + cy * 2 * (cy * 2)) + 10;
  let eyeRadius = 0;
  if (t >= VORTEX_START && t < VORTEX_END) {
    // The eye opens gradually: slow start, then accelerating.
    const p = easeInOut((t - VORTEX_START) / (VORTEX_END - VORTEX_START));
    // Eye radius trails behind the tornado ring (ring is ~5 cells ahead of the eye).
    eyeRadius = Math.max(0, p * maxRadius * 0.8 - 3);
  } else if (t >= VORTEX_END) {
    eyeRadius = maxRadius;
  }

  // --- Phase 1–3: Cursor blink + typing + pause ---
  if (t < VORTEX_START) {
    renderPromptPhase(config, t, seed, cx, cy, cols, rows, overlay);
  }

  // --- Phase 4: Tornado vortex ---
  if (t >= VORTEX_START && t < VORTEX_END) {
    eyeRadius = renderTornadoPhase(
      config,
      t,
      seed,
      cx,
      cy,
      cols,
      rows,
      maxRadius,
      vortexChars,
      overlay,
    );
  }

  // --- Phase 7: Cycle spawns at screen center ---
  if (t >= SPAWN_START) {
    renderSpawnPhase(config, t, cols, rows, overlay);
  }

  // --- Build rows with minimal escapes ---
  const result: string[] = [];
  for (let y = 0; y < rows; y++) {
    let row = floorBg;
    let lastFg = '';
    for (let x = 0; x < cols; x++) {
      const ov = overlay.get(`${y},${x}`);
      if (ov !== undefined) {
        row += ov;
        lastFg = '';
      } else if (showDots) {
        // Inside the eye: breathing dots visible. Outside: dark.
        // This creates the "looking through the tornado into the grid" effect.
        const dx = x - cx;
        const dy = (y - cy) * 2; // aspect ratio: terminal chars are ~2x tall
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= eyeRadius) {
          if (lastFg !== dotFg) {
            row += dotFg;
            lastFg = dotFg;
          }
          row += '.';
        } else {
          row += ' ';
          lastFg = '';
        }
      } else {
        row += ' ';
      }
    }
    row += RESET;
    result.push(row);
  }
  return result;
}

// ---- Phase helpers (extracted to keep introFrame under the soft cap) ----

function renderPromptPhase(
  config: IntroConfig,
  t: number,
  seed: number,
  cx: number,
  cy: number,
  cols: number,
  rows: number,
  overlay: Map<string, string>,
): void {
  const prompt = `>${config.identity}`;
  const promptX = cx - Math.floor(prompt.length / 2);
  const introFg = ansiFg(COLOR_INTRO[0], COLOR_INTRO[1], COLOR_INTRO[2]);
  let visibleLen = 0;
  if (t < CURSOR_END) {
    visibleLen = 1;
  } else if (t < TYPING_END) {
    visibleLen =
      1 + Math.floor(((t - TYPING_START) / (TYPING_END - TYPING_START)) * config.identity.length);
  } else {
    visibleLen = prompt.length;
  }
  const cursorChar = Math.floor(t / 500) % 2 === 0 ? '_' : ' ';
  for (let i = 0; i < visibleLen && i < prompt.length; i++) {
    overlay.set(`${cy},${promptX + i}`, introFg + (prompt[i] ?? ' '));
  }
  if (visibleLen <= prompt.length) {
    overlay.set(`${cy},${promptX + visibleLen}`, introFg + cursorChar);
  }
  if (seed % 100 === 0 && t >= TYPING_END) {
    const msg = HIDDEN_MESSAGES[(seed >> 8) % HIDDEN_MESSAGES.length] ?? '';
    const msgX = cx - Math.floor(msg.length / 2);
    const msgFg = ansiFg(60, 50, 40);
    for (let i = 0; i < msg.length; i++) {
      if (msgX + i >= 0 && msgX + i < cols && cy + 2 >= 0 && cy + 2 < rows) {
        overlay.set(`${cy + 2},${msgX + i}`, msgFg + (msg[i] ?? ' '));
      }
    }
  }
}

function renderTornadoPhase(
  config: IntroConfig,
  t: number,
  seed: number,
  cx: number,
  cy: number,
  cols: number,
  rows: number,
  maxRadius: number,
  vortexChars: ReadonlyArray<TornadoParticle> | undefined,
  overlay: Map<string, string>,
): number {
  const particles = vortexChars ?? initTornado(config, seed);
  const dt = (t - VORTEX_START) / 1000;
  const totalDuration = (VORTEX_END - VORTEX_START) / 1000;
  const initRadius = Math.max(4, Math.min(cols, rows) * 0.12);
  const formFrac = FORMATION_MS / 1000;
  const formProgress = easeInOut(Math.min(1, dt / formFrac));
  const formed = dt >= formFrac;
  let minOnScreenRadius = maxRadius;
  const colorP = easeInOut(dt / totalDuration);
  const fg = ansiFg(
    Math.round(lerp(COLOR_INTRO[0], COLOR_WALL[0], colorP)),
    Math.round(lerp(COLOR_INTRO[1], COLOR_WALL[1], colorP)),
    Math.round(lerp(COLOR_INTRO[2], COLOR_WALL[2], colorP)),
  );
  for (const p of particles) {
    const expandDt = Math.max(0, dt - formFrac);
    const ringRadius = initRadius + p.radialV * easeInOut(expandDt / totalDuration) * expandDt;
    const angle = p.angle0 + p.angularV * dt;
    const x = Math.round(lerp(p.originX, cx + Math.cos(angle) * ringRadius, formProgress));
    const y = Math.round(lerp(p.originY, cy + Math.sin(angle) * ringRadius * 0.45, formProgress));
    if (x < 0 || x >= cols || y < 0 || y >= rows) continue;
    if (formed) minOnScreenRadius = Math.min(minOnScreenRadius, ringRadius);
    overlay.set(`${y},${x}`, fg + p.char);
  }
  return formed ? Math.max(0, minOnScreenRadius - 2) : 0;
}

function renderSpawnPhase(
  config: IntroConfig,
  t: number,
  cols: number,
  rows: number,
  overlay: Map<string, string>,
): void {
  const p = Math.min(1, (t - SPAWN_START) / (SPAWN_END - SPAWN_START));
  // Spawn at screen center — double-wide to match the game renderer (2 chars/cell).
  const sx = Math.floor(cols / 2) - 1;
  const sy = Math.floor(rows / 2);
  if (sy >= 0 && sy < rows && sx >= 0 && sx + 1 < cols) {
    const fg = ansiFg(
      Math.round(lerp(COLOR_INTRO[0], config.identityColor[0], p)),
      Math.round(lerp(COLOR_INTRO[1], config.identityColor[1], p)),
      Math.round(lerp(COLOR_INTRO[2], config.identityColor[2], p)),
    );
    overlay.set(`${sy},${sx}`, fg + GLYPH_HEAD);
    overlay.set(`${sy},${sx + 1}`, fg + GLYPH_HEAD);
  }
}

export async function playIntro(
  writer: AnsiWriter,
  config: IntroConfig,
  seed: number,
): Promise<void> {
  const vortexChars = initTornado(config, seed);
  return new Promise<void>((resolve) => {
    const start = performance.now();
    let prevFrame: string[] = [];
    const interval = setInterval(() => {
      const t = performance.now() - start;
      if (t >= INTRO_DURATION_MS) {
        clearInterval(interval);
        resolve();
        return;
      }
      const frame = introFrame(config, t, seed, vortexChars);
      if (prevFrame.length === 0) {
        writer.endFrame(frame);
      } else {
        writeDiff(writer, prevFrame, frame);
      }
      prevFrame = frame;
    }, FRAME_INTERVAL_MS);
  });
}

function writeDiff(
  writer: AnsiWriter,
  prev: ReadonlyArray<string>,
  next: ReadonlyArray<string>,
): void {
  const chunks: string[] = [];
  for (let i = 0; i < next.length; i++) {
    if (next[i] !== prev[i]) {
      chunks.push(moveTo(i + 1, 1) + (next[i] ?? ''));
    }
  }
  if (chunks.length > 0) {
    writer.writeDiff(chunks.join(''));
  }
}
