// CLI entry point for `npx grid forge`.
//
// Parses forge-specific arguments, assembles the prompt, calls the LLM,
// saves the daemon, runs the sandbox, and reports the result.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DAEMON_MAX_SOURCE_BYTES } from '../constants.js';
import { buildForgePrompt, stripFences } from './prompt.js';
import { detectProvider, printProviderHelp } from './providers.js';
import { runSandbox } from './sandbox.js';

const DAEMONS_DIR = join(homedir(), '.grid', 'daemons');

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Derive a filename from a description string. */
function nameFromDescription(desc: string): string {
  // Take first 3 words, kebab-case, lowercase, strip non-alphanum.
  return (
    desc
      .toLowerCase()
      .split(/\s+/)
      .slice(0, 3)
      .join('-')
      .replace(/[^a-z0-9-]/g, '')
      .slice(0, 30) || 'daemon'
  );
}

export async function runForgeCli(args: string[]): Promise<void> {
  // Parse args.
  let description = '';
  let refineName: string | null = null;
  let minimal = false;
  let showName: string | null = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--refine') {
      refineName = args[++i] ?? null;
    } else if (arg === '--minimal') {
      minimal = true;
    } else if (arg === '--show') {
      showName = args[++i] ?? null;
    } else if (arg && !arg.startsWith('--')) {
      description += (description ? ' ' : '') + arg;
    }
  }

  // --show: just print the daemon source and exit.
  if (showName !== null) {
    const path = join(DAEMONS_DIR, `${showName}.cjs`);
    if (!existsSync(path)) {
      process.stderr.write(`forge: daemon "${showName}" not found at ${path}\n`);
      process.exit(1);
    }
    process.stdout.write(readFileSync(path, 'utf-8'));
    return;
  }

  if (!description) {
    process.stderr.write('usage: npx grid forge "describe your daemon"\n');
    process.stderr.write('       npx grid forge --refine name "changes"\n');
    process.stderr.write('       npx grid forge --minimal "describe"\n');
    process.stderr.write('       npx grid forge --show name\n');
    process.exit(1);
  }

  // Detect LLM provider.
  const provider = detectProvider();
  if (provider === null) {
    printProviderHelp();
    process.exit(1);
  }

  process.stderr.write(`forge: using ${provider.name}\n`);

  // Load existing source for --refine.
  let existingSource: string | undefined;
  if (refineName !== null) {
    const path = join(DAEMONS_DIR, `${refineName}.cjs`);
    if (!existsSync(path)) {
      process.stderr.write(`forge: daemon "${refineName}" not found at ${path}\n`);
      process.exit(1);
    }
    existingSource = readFileSync(path, 'utf-8');
  }

  // Build prompt and call LLM.
  const prompt = buildForgePrompt({
    description,
    minimal,
    ...(existingSource !== undefined ? { existingSource } : {}),
  });
  process.stderr.write('forge: generating daemon...\n');

  let script: string;
  try {
    const raw = await provider.generate(prompt);
    script = stripFences(raw);
  } catch (err) {
    process.stderr.write(`forge: LLM error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }

  if (!script || script.length < 10) {
    process.stderr.write('forge: LLM returned empty or too-short output\n');
    process.exit(1);
  }

  // Check byte count.
  const byteCount = Buffer.byteLength(script, 'utf-8');
  if (byteCount > DAEMON_MAX_SOURCE_BYTES) {
    process.stderr.write(
      `forge: daemon is ${byteCount} bytes (max ${DAEMON_MAX_SOURCE_BYTES}), asking LLM to shrink...\n`,
    );
    // One retry with a corrective prompt.
    try {
      const retryPrompt = buildForgePrompt({
        description: `${description}\n\nIMPORTANT: Your previous output was ${byteCount} bytes. The maximum is ${DAEMON_MAX_SOURCE_BYTES}. Produce a smaller version.`,
        existingSource: script,
        minimal: true,
      });
      const raw = await provider.generate(retryPrompt);
      script = stripFences(raw);
    } catch (err) {
      process.stderr.write(
        `forge: retry error: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(1);
    }
    const retryBytes = Buffer.byteLength(script, 'utf-8');
    if (retryBytes > DAEMON_MAX_SOURCE_BYTES) {
      process.stderr.write(`forge: still ${retryBytes} bytes after retry — giving up\n`);
      process.exit(1);
    }
  }

  // Save the daemon.
  const name = refineName ?? nameFromDescription(description);
  ensureDir(DAEMONS_DIR);
  // Use .cjs so daemons can use require() even when the project has "type": "module".
  const outPath = join(DAEMONS_DIR, `${name}.cjs`);
  writeFileSync(outPath, script, 'utf-8');
  const finalBytes = Buffer.byteLength(script, 'utf-8');

  process.stderr.write(`forge: saved to ${outPath}\n`);
  process.stderr.write('forge: running sandbox test...\n');

  // Run sandbox.
  const result = await runSandbox(outPath);

  if (result.passed) {
    const pct = Math.round((finalBytes / DAEMON_MAX_SOURCE_BYTES) * 100);
    process.stderr.write(
      `\n✓ ${name}.cjs — ${finalBytes} bytes / ${DAEMON_MAX_SOURCE_BYTES} max  (${pct}% of cap)\n`,
    );
    process.stderr.write(`  survived ${result.survivalTicks} ticks in sandbox\n`);
    process.stderr.write(`  ready to deploy: npx grid --deploy ${outPath}\n\n`);
  } else {
    process.stderr.write(`\n✗ ${name}.cjs — sandbox failed\n`);
    if (result.error) process.stderr.write(`  error: ${result.error}\n`);
    process.stderr.write(`  survived ${result.survivalTicks} ticks (need 30+)\n`);
    process.stderr.write(
      `  the daemon was saved — you can try: npx grid forge --refine ${name} "fix the issue"\n\n`,
    );
  }
}
