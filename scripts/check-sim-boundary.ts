// Boundary enforcement for `src/sim/`.
//
// This script runs as part of `npm test`. It walks every `.ts` file under `src/sim/`
// and rejects:
//   - any import path that escapes `src/sim/` (relative `../` going up out of the dir)
//   - any `node:` import other than the single allowlisted exception:
//       `src/sim/hash.ts` may import `node:crypto`
//   - any forbidden API usage in the file body:
//       Math.random, Date.now, performance.now, process.env, crypto.randomBytes
//   - any direct iteration over `.values()`, `.entries()`, or `.keys()` on a non-sortedXxx
//     source (heuristic — false positives are tolerable; the canonical access pattern
//     is `iter.ts`).
//
// The script itself uses `node:fs` and `node:path` because it runs OUTSIDE the
// simulation boundary — it's tooling, not simulation code.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const SIM_ROOT = resolve('src/sim');
const ALLOWED_NODE_IMPORTS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  [join(SIM_ROOT, 'hash.ts'), new Set(['node:crypto'])],
]);

const FORBIDDEN_API = [
  /\bMath\.random\b/,
  /\bDate\.now\b/,
  /\bperformance\.now\b/,
  /\bprocess\.env\b/,
  /\bcrypto\.randomBytes\b/,
];

// Detects `for ... of <expr>.values()`, etc., where <expr> is NOT a `sortedXxx(...)` call.
// Heuristic but adequate: any line containing `.values()`, `.entries()`, or `.keys()`
// inside a `for` loop fails unless the same line also contains `sorted`.
const ITER_BAD = /for\s*\([^)]*\bof\s+[^)]*\.(values|entries|keys)\s*\(\s*\)/;

interface Failure {
  file: string;
  line: number;
  reason: string;
}

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (full.endsWith('.ts')) out.push(full);
  }
}

function checkFile(file: string): Failure[] {
  const failures: Failure[] = [];
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');

  // Imports — anchored to start-of-line so we don't match `import`/`from` inside
  // strings or comments.
  const importRegex = /^(?:import|export)\b[^'"\n]*?\bfrom\s+['"]([^'"]+)['"]/gm;
  let m: RegExpExecArray | null;
  while ((m = importRegex.exec(text)) !== null) {
    const spec = m[1];
    if (spec === undefined) continue;
    const lineIdx = text.slice(0, m.index).split('\n').length;
    if (spec.startsWith('node:')) {
      const allowed = ALLOWED_NODE_IMPORTS.get(file) ?? new Set<string>();
      if (!allowed.has(spec)) {
        failures.push({
          file,
          line: lineIdx,
          reason: `forbidden node: import "${spec}" — only hash.ts may import node:crypto`,
        });
      }
    } else if (spec.startsWith('.')) {
      // Resolve and ensure the result stays inside SIM_ROOT.
      const resolved = resolve(file, '..', spec);
      const rel = relative(SIM_ROOT, resolved);
      if (rel.startsWith('..') || rel.startsWith(`..${sep}`)) {
        failures.push({
          file,
          line: lineIdx,
          reason: `import escapes src/sim/: "${spec}"`,
        });
      }
    } else {
      failures.push({
        file,
        line: lineIdx,
        reason: `external import not allowed in src/sim/: "${spec}"`,
      });
    }
  }

  // API and iteration scans (per line so we can report a useful line number).
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    // Strip trailing comments to reduce false positives. Crude but adequate.
    const code = line.replace(/\/\/.*$/, '');
    for (const re of FORBIDDEN_API) {
      if (re.test(code)) {
        failures.push({
          file,
          line: i + 1,
          reason: `forbidden API: ${re.source}`,
        });
      }
    }
    if (ITER_BAD.test(code) && !/sorted/.test(code)) {
      failures.push({
        file,
        line: i + 1,
        reason: 'unsorted Map iteration — use sortedKeys/sortedEntries/sortedValuesByKey',
      });
    }
  }

  return failures;
}

function main(): void {
  const files: string[] = [];
  walk(SIM_ROOT, files);
  const allFailures: Failure[] = [];
  for (const f of files) {
    allFailures.push(...checkFile(f));
  }
  if (allFailures.length > 0) {
    console.error('check-sim-boundary: violations found:');
    for (const f of allFailures) {
      console.error(`  ${relative(process.cwd(), f.file)}:${f.line}  ${f.reason}`);
    }
    process.exit(1);
  }
  console.log(`check-sim-boundary: OK (${files.length} files clean)`);
}

main();
