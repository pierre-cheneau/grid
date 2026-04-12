// Subprocess transport: spawns a daemon as a child process, communicates via
// newline-delimited JSON over stdin/stdout.

import { type ChildProcess, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { DaemonTransport } from './transport.js';

export function createSubprocessTransport(scriptPath: string): DaemonTransport {
  const isJs =
    scriptPath.endsWith('.js') || scriptPath.endsWith('.mjs') || scriptPath.endsWith('.cjs');
  const child: ChildProcess = isJs
    ? spawn(process.execPath, [scriptPath], { stdio: ['pipe', 'pipe', 'pipe'] })
    : spawn(scriptPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });

  let lineCallback: ((line: string) => void) | null = null;
  let exitCallback: ((code: number | null, error?: string) => void) | null = null;
  let exited = false;

  // Swallow EPIPE on stdin — the daemon may exit before we stop writing.
  child.stdin?.on('error', () => {});

  // stdio is 'pipe' so stdout/stderr are guaranteed non-null.
  // biome-ignore lint/style/noNonNullAssertion: stdio: 'pipe' guarantees non-null
  const rl = createInterface({ input: child.stdout! });
  rl.on('line', (line) => lineCallback?.(line));

  // Capture stderr for debug (last 20 lines).
  const stderrLines: string[] = [];
  // biome-ignore lint/style/noNonNullAssertion: stdio: 'pipe' guarantees non-null
  const stderrRl = createInterface({ input: child.stderr! });
  stderrRl.on('line', (line) => {
    stderrLines.push(line);
    if (stderrLines.length > 20) stderrLines.shift();
  });

  const cleanup = () => {
    rl.close();
    stderrRl.close();
  };

  child.on('error', (err) => {
    if (!exited) {
      exited = true;
      cleanup();
      exitCallback?.(null, err.message);
    }
  });
  child.on('exit', (code) => {
    if (!exited) {
      exited = true;
      cleanup();
      const errCtx = stderrLines.length > 0 ? stderrLines.join('\n') : undefined;
      exitCallback?.(code, errCtx);
    }
  });

  return {
    send(line: string): void {
      if (!exited && child.stdin && !child.stdin.destroyed) {
        child.stdin.write(`${line}\n`);
      }
    },
    onLine(cb: (line: string) => void): void {
      lineCallback = cb;
    },
    onExit(cb: (code: number | null, error?: string) => void): void {
      exitCallback = cb;
    },
    kill(): void {
      if (exited) return;
      cleanup();
      try {
        child.kill('SIGTERM');
      } catch {
        // already dead
      }
      // Force-kill after 2s if still alive.
      const timer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // already dead
        }
      }, 2000);
      timer.unref();
    },
  };
}
