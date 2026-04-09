// Glyph table, mandated colors, and bucket cutoffs for the terminal renderer.
//
// Every constant in this file is normative — they correspond directly to lines in
// `docs/design/identity-and-aesthetic.md`. Bumping any of them is a design change,
// not a refactor. Cite the spec line in the commit message if you do.

/**
 * Cycle head glyph. The head is rendered in the cycle's identity color, full
 * opacity, no fade. `identity-and-aesthetic.md` §52.
 */
export const GLYPH_HEAD = '█';

/**
 * Trail glyphs in descending freshness order. Index 0 is freshest (right behind
 * the head); index 3 is the dimmest, just before removal. `identity-and-aesthetic.md`
 * §52: "trailing cell behind the head is `▓` (slightly dimmer) ... older trail cells
 * fade through `▒` and `░`".
 *
 * The 4-glyph table aligns with the 4 age buckets in `age.ts::ageBucket`.
 */
export const GLYPH_TRAIL: readonly [string, string, string, string] = ['█', '▓', '▒', '░'];

/** Floor cell glyph. A dot that breathes with a slow color pulse — the grid is alive. */
export const GLYPH_FLOOR = '.';

/**
 * Box-drawing characters for the play-area frame. `identity-and-aesthetic.md` §40-46.
 * Walls in the play area are reserved for v0.2; in v0.1 we only draw the outer frame.
 */
export const BOX_TOP_LEFT = '┌';
export const BOX_TOP_RIGHT = '┐';
export const BOX_BOTTOM_LEFT = '└';
export const BOX_BOTTOM_RIGHT = '┘';
export const BOX_HORIZONTAL = '─';
export const BOX_VERTICAL = '│';

/**
 * Mandated colors from `identity-and-aesthetic.md` §60. RGB triples; the renderer
 * encodes them as 24-bit ANSI escapes via `color.ts::ansiFg`/`ansiBg`.
 */
export const COLOR_FLOOR: readonly [number, number, number] = [0x0a, 0x0a, 0x1a]; // #0a0a1a — dim blue-black
export const COLOR_WALL: readonly [number, number, number] = [0x00, 0xff, 0xff]; // #00ffff — cyan
export const COLOR_INTRO: readonly [number, number, number] = [0x00, 0xff, 0x41]; // #00ff41 — Matrix green
export const COLOR_HUD: readonly [number, number, number] = [0xff, 0xff, 0xff]; // white
export const COLOR_WARN: readonly [number, number, number] = [0xff, 0x00, 0xff]; // magenta — derez/warnings (Stage 4)

/**
 * Number of decay buckets. Drives both `ageBucket` (which selects a glyph) and the
 * width of `GLYPH_TRAIL`. Changing this number requires updating both.
 */
export const DECAY_BUCKETS = 4 as const;

/**
 * Minimum extra rows the renderer needs around the play area:
 *   1 top border + 1 bottom border + 1 status row = 3.
 * Used by `buildFrame` to decide if the viewport is large enough.
 */
export const FRAME_OVERHEAD_ROWS = 3 as const;

/**
 * Minimum extra columns the renderer needs around the play area:
 *   1 left border + 1 right border = 2.
 */
export const FRAME_OVERHEAD_COLS = 2 as const;

/** Hidden messages that appear 1-in-100 plays during the intro pause phase. */
export const HIDDEN_MESSAGES: readonly string[] = [
  'end of line',
  'i fight for the users',
  'the grid — a digital frontier',
  'greetings program',
  'programs do not die — they are derezzed',
  'the only way to win is to not play alone',
];
