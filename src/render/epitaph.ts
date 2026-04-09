// Exit epitaph: the 2-line colored message printed to the player's actual shell
// scrollback after alt-screen exits. Per `identity-and-aesthetic.md` line 137:
// "The epitaph is the only trace GRID leaves on the player's machine outside
// ~/.grid/. It lives in their shell scrollback."
//
// Pure function — no I/O. The caller writes the result to stdout.

import { RESET } from './ansi.js';
import { ansiFg } from './color.js';

export interface EpitaphData {
  readonly identity: string;
  readonly identityColor: readonly [number, number, number];
  readonly durationMs: number;
  readonly derezzes: number;
  readonly deaths: number;
  readonly longestRunMs: number;
}

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}m ${sec}s`;
}

function padLine(content: string, width: number, fillChar: string): string {
  const remaining = Math.max(0, width - content.length);
  return content + fillChar.repeat(remaining);
}

/**
 * Generate the exit epitaph for shell scrollback. Returns a string with embedded
 * ANSI color escapes and a trailing RESET + newline.
 *
 * Format:
 * ```
 * ── corne@thinkpad ──────────────────────────────
 * visited the grid for 1m 34s · 4 derezzes · 6 deaths · longest run 18s
 * ── npx grid recap ──────────────────────────────
 * ```
 */
export function renderEpitaph(data: EpitaphData, termWidth: number): string {
  const fg = ansiFg(data.identityColor[0], data.identityColor[1], data.identityColor[2]);
  const white = ansiFg(255, 255, 255);
  const w = Math.max(40, termWidth);

  const header = `── ${data.identity} `;
  const footer = '── npx grid recap ';
  const stats = `visited the grid for ${formatDuration(data.durationMs)} · ${data.derezzes} derezzes · ${data.deaths} deaths · longest run ${formatDuration(data.longestRunMs)}`;

  return `\n${fg}${padLine(header, w, '─')}${RESET}\n${white}${stats}${RESET}\n${fg}${padLine(footer, w, '─')}${RESET}\n`;
}
