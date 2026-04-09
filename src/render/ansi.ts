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

/** Xterm XTWINOPS maximize escape. Silently ignored by unsupported terminals. */
export const MAXIMIZE = '\x1b[9;1t';

/**
 * Best-effort terminal maximize. Uses platform-specific methods:
 * - Windows: ShowWindow(SW_MAXIMIZE) via a tiny PowerShell call (~300ms)
 * - macOS/Linux: xterm XTWINOPS escape \x1b[9;1t (instant, but only works
 *   on xterm-compatible terminals)
 *
 * After the maximize attempt, waits up to 300ms for a `resize` event to
 * detect the new dimensions. The animation adapts to whatever size it gets.
 */
export async function tryMaximize(out: NodeJS.WriteStream): Promise<void> {
  if (!out.isTTY) return;

  if (process.platform === 'win32') {
    // Windows: cmd.exe/conhost ignores xterm escapes. Call Win32
    // ShowWindow(GetConsoleWindow(), SW_MAXIMIZE) via a temp PowerShell
    // script to avoid cmd.exe → Node → PowerShell quote-escaping hell.
    try {
      const { execSync } = await import('node:child_process');
      const { writeFileSync, unlinkSync } = await import('node:fs');
      const { join } = await import('node:path');
      const { tmpdir } = await import('node:os');
      const script = join(tmpdir(), `grid-max-${process.pid}.ps1`);
      writeFileSync(
        script,
        [
          "Add-Type -Name W -Namespace C -MemberDefinition @'",
          '[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);',
          '[DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();',
          "'@",
          '[C.W]::ShowWindow([C.W]::GetConsoleWindow(), 3) | Out-Null',
        ].join('\n'),
      );
      execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${script}"`, {
        stdio: 'ignore',
        timeout: 3000,
      });
      try {
        unlinkSync(script);
      } catch {
        /* cleanup best-effort */
      }
    } catch {
      // Best-effort: if PowerShell isn't available, continue at current size.
    }
  } else {
    out.write(MAXIMIZE);
  }

  // Wait for the terminal to report its new dimensions via a resize event.
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 300);
    const onResize = () => {
      clearTimeout(timer);
      out.removeListener('resize', onResize);
      setTimeout(resolve, 50);
    };
    out.on('resize', onResize);
  });
}
