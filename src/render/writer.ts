// The renderer's I/O surface. The ONLY file in `src/render/` that touches stdout.
//
// `AnsiWriter` owns the alt-screen entry/exit, the cursor visibility toggle, and
// the per-frame synchronized output mode brackets. It accepts any
// `NodeJS.WritableStream` so tests can inject an in-memory `Writable` and assert
// on the bytes (per `docs/engineering/testing.md` §122).
//
// Pre-allocated buffers per `docs/engineering/performance.md` §149: the renderer's
// frame buffer is allocated once and reused. We hold a single string accumulator
// rebuilt in place each frame; nothing else is per-frame allocated.
//
// `cleanupTerminal()` is a standalone, idempotent function that emits the minimum
// recovery escapes directly to `process.stdout`. The CLI's top-level error handler
// calls it without needing a writer reference.

import { stdout as nodeStdout } from 'node:process';
import {
  CLEAR_SCREEN,
  ENTER_ALT,
  EXIT_ALT,
  HIDE_CURSOR,
  RESET,
  SHOW_CURSOR,
  SYNC_BEGIN,
  SYNC_END,
} from './ansi.js';

export interface AnsiWriterOpts {
  readonly stdout: NodeJS.WritableStream;
}

export class AnsiWriter {
  private readonly stdout: NodeJS.WritableStream;
  private started = false;
  private stopped = false;

  constructor(opts: AnsiWriterOpts) {
    this.stdout = opts.stdout;
  }

  /** Enter alt-screen, hide cursor, clear screen. Idempotent. */
  begin(): void {
    if (this.started) return;
    this.started = true;
    this.stdout.write(ENTER_ALT + HIDE_CURSOR + CLEAR_SCREEN);
  }

  /**
   * Write a full frame. Uses cork/uncork to batch the entire frame into a single
   * WriteFile syscall — the most effective flicker prevention on Windows conhost.
   * Cursor-home + sequential rows minimizes escape sequence overhead.
   */
  endFrame(rows: ReadonlyArray<string>): void {
    if (this.stopped) return;
    this.writeCorked(`${SYNC_BEGIN}\x1b[H${rows.join('\r\n')}${SYNC_END}`);
  }

  /** Write a diff patch (only changed rows). Used by the intro animation. */
  writeDiff(data: string): void {
    if (this.stopped || data.length === 0) return;
    this.writeCorked(SYNC_BEGIN + data + SYNC_END);
  }

  /** Batch a write into a single syscall via cork/uncork. */
  private writeCorked(data: string): void {
    const stream = this.stdout as NodeJS.WriteStream;
    if ('cork' in stream) stream.cork();
    stream.write(data);
    if ('uncork' in stream) stream.uncork();
  }

  /** Restore cursor, exit alt-screen, leave terminal as we found it. Idempotent. */
  shutdown(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.stdout.write(RESET + SHOW_CURSOR + EXIT_ALT);
  }
}

/**
 * Standalone terminal-cleanup function for the CLI's top-level error handler.
 * Writes the minimum recovery escapes to `process.stdout` without needing a writer
 * instance. Safe to call from any context, idempotent across calls.
 */
let cleaned = false;
export function cleanupTerminal(): void {
  if (cleaned) return;
  cleaned = true;
  try {
    nodeStdout.write(RESET + SHOW_CURSOR + EXIT_ALT);
  } catch {
    // Best-effort cleanup; if stdout is gone we can't do anything else.
  }
}
