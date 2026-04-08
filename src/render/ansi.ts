// CSI escape sequences used by the renderer.
//
// Single source of truth for the byte sequences. Importing modules use these
// constants by name; nothing else in `src/render/` may write raw `\x1b[...]`
// strings (except `color.ts` for the 24-bit fg/bg builders, which are themselves
// pure helpers).
//
// References:
//  - https://en.wikipedia.org/wiki/ANSI_escape_code
//  - synchronized output mode: https://gist.github.com/christianparpart/d8a62cc1ab659194337d73e399004036

/** Enter the alternate screen buffer (preserves shell scrollback underneath). */
export const ENTER_ALT = '\x1b[?1049h';
/** Leave the alternate screen buffer. */
export const EXIT_ALT = '\x1b[?1049l';

/** Hide / show the terminal cursor. */
export const HIDE_CURSOR = '\x1b[?25l';
export const SHOW_CURSOR = '\x1b[?25h';

/** Clear the entire screen (does not move the cursor). */
export const CLEAR_SCREEN = '\x1b[2J';

/**
 * Synchronized output mode: bracket a frame to prevent tearing on supporting
 * terminals (Kitty, iTerm2, Windows Terminal, recent VTE). Terminals that don't
 * recognize the escape ignore it silently as an unknown sequence — emitting it
 * unconditionally is therefore safe and avoids a startup probe.
 */
export const SYNC_BEGIN = '\x1b[?2026h';
export const SYNC_END = '\x1b[?2026l';

/** Reset all SGR attributes (color, bold, etc). */
export const RESET = '\x1b[0m';

/**
 * Move the cursor to (row, col), 1-indexed per the ANSI spec. Pure string builder.
 * The renderer addresses cells with 0-indexed (x, y) and converts at the call site.
 */
export function moveTo(row1: number, col1: number): string {
  return `\x1b[${row1};${col1}H`;
}
