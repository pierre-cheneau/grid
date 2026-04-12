// Prompt assembly for the forge command.
//
// Bundles AGENTS.md (the LLM-facing daemon reference) with the user's
// description and forge-specific instructions.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const AGENTS_PATH = join(ROOT, 'AGENTS.md');

export interface ForgePromptOpts {
  readonly description: string;
  readonly existingSource?: string;
  readonly minimal: boolean;
}

export function buildForgePrompt(opts: ForgePromptOpts): string {
  let agents: string;
  try {
    agents = readFileSync(AGENTS_PATH, 'utf-8');
  } catch {
    agents = '(AGENTS.md not found — write a GRID daemon using the description below)';
  }

  const parts: string[] = [];

  parts.push('You are writing a daemon for GRID, a terminal-native multiplayer game.');
  parts.push(
    'Read the daemon reference below, then produce a single self-contained Node.js script.',
  );
  parts.push('Output ONLY the script — no markdown fences, no commentary, no explanation.');
  parts.push('The script must use only Node.js built-in modules (no npm packages).');
  parts.push('The script must be under 4096 bytes (UTF-8).');
  parts.push('');

  if (opts.minimal) {
    parts.push(
      'IMPORTANT: The user wants the SMALLEST possible daemon (chasing the Minimalist crown).',
    );
    parts.push('Optimize aggressively: one-letter variable names, no comments, no blank lines,');
    parts.push('densest idioms possible. Target 400-800 bytes. Behavior must still be correct.');
    parts.push('');
  }

  parts.push('--- DAEMON REFERENCE ---');
  parts.push(agents);
  parts.push('--- END REFERENCE ---');
  parts.push('');

  if (opts.existingSource) {
    parts.push('--- EXISTING DAEMON TO MODIFY ---');
    parts.push(opts.existingSource);
    parts.push('--- END EXISTING DAEMON ---');
    parts.push('');
    parts.push(`The user wants to change this daemon: ${opts.description}`);
    parts.push('Produce the updated version. Keep what works, change what the user asked for.');
  } else {
    parts.push(`Write a daemon that: ${opts.description}`);
  }

  return parts.join('\n');
}

/** Strip markdown code fences from LLM output (```js ... ``` or ``` ... ```). */
export function stripFences(raw: string): string {
  const trimmed = raw.trim();
  // Match opening fence with optional language tag.
  const openMatch = trimmed.match(/^```(?:\w+)?\s*\n/);
  if (!openMatch) return trimmed;
  const withoutOpen = trimmed.slice(openMatch[0].length);
  // Match closing fence.
  const closeIdx = withoutOpen.lastIndexOf('```');
  if (closeIdx < 0) return withoutOpen.trim();
  return withoutOpen.slice(0, closeIdx).trim();
}
