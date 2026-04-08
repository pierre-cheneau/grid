// Diagnostic logging for the network layer.
//
// Off by default: `dbg(...)` is a no-op until the CLI calls `setDebugLogger`.
// When enabled, the CLI writes lines to `./grid-debug-<pid>.log` so the alt-screen
// renderer is not corrupted by interleaved stderr.
//
// This file exists temporarily to investigate the two-terminal connectivity issue.
// Once Stage 5.1 ships and the bug is fixed, the calls can stay (they're no-ops
// in production) or be removed via a single grep.

type Logger = (msg: string) => void;

let logger: Logger | null = null;

export function setDebugLogger(fn: Logger | null): void {
  logger = fn;
}

export function dbg(msg: string): void {
  if (logger === null) return;
  logger(msg);
}

export function isDebug(): boolean {
  return logger !== null;
}
