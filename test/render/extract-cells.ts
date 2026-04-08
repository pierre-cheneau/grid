// Strip ANSI escapes from a frame and return the bare 2D glyph grid.
// Used by `grid.test.ts` to assert cell-level properties without binding to the
// exact escape encoding.
//
// Per `docs/engineering/testing.md` §100, snapshot-testing the raw escape sequences
// is brittle. Cell-level extraction lets the tests describe behavior ("the head
// glyph is at column 5") instead of implementation ("byte 47 is 0x1b").

// biome-ignore lint/suspicious/noControlCharactersInRegex: ESC (\x1b) is the literal byte we are stripping
const ANSI_RE = /\x1b\[[0-9;?]*[a-zA-Z]/g;

/**
 * Strip ANSI escapes from each row and return one entry per visible character.
 *
 * Returned shape: `cells[y][x]` is the bare glyph at terminal column `x`, row `y`.
 * Box-drawing borders are included; the play area starts at `cells[1][1]` and
 * extends to `cells[gridH][gridW]`. The status row is `cells[gridH+2]`.
 */
export function extractCells(rows: ReadonlyArray<string>): string[][] {
  return rows.map((row) => Array.from(row.replace(ANSI_RE, '')));
}

/** Strip ANSI escapes from a single row, returning the visible string. */
export function stripAnsi(row: string): string {
  return row.replace(ANSI_RE, '');
}
