# Code style

The conventions for writing GRID code. These rules are intentionally specific and verifiable. Most of them are enforced automatically by Prettier, ESLint, and TypeScript's strict mode. The few that aren't are checked in code review.

## TypeScript configuration

GRID uses **TypeScript in strict mode**, with the following non-default flags enabled in `tsconfig.json`:

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": true,
    "noPropertyAccessFromIndexSignature": true,
    "isolatedModules": true,
    "module": "node16",
    "target": "es2022",
    "verbatimModuleSyntax": true
  }
}
```

These flags catch real bugs that would otherwise become runtime issues. None of them are negotiable. If a file refuses to compile with these flags, the file is wrong, not the flags.

## The `any` rule

**Never use `any`.** Not in production code, not in test code, not as a "temporary" placeholder.

If you genuinely don't know the type of a value (e.g., a JSON-parsed message from the network), use `unknown` and narrow it with type guards before use:

```ts
// ❌ WRONG
function handleMessage(msg: any) { return msg.type; }

// ✅ RIGHT
function handleMessage(msg: unknown) {
  if (typeof msg !== 'object' || msg === null || !('type' in msg)) {
    throw new ProtocolError('malformed message');
  }
  return (msg as { type: unknown }).type;
}
```

The discipline that `unknown` forces is exactly the discipline you want at a trust boundary. See [`errors-and-boundaries.md`](errors-and-boundaries.md) for the validation patterns.

## Immutability and `readonly`

Default to immutable data. Mutable data is permitted but must be local to the function that owns it.

- **Type definitions use `readonly` everywhere by default.** A field is mutable only if there is a clear reason it must be.
- **Function parameters that are objects or arrays are treated as readonly.** If you need to mutate, copy first.
- **Array methods that return new arrays (`map`, `filter`, `slice`, `concat`) are preferred** over methods that mutate in place (`push`, `splice`, `sort` without slice).
- **`const` over `let`** unless the binding genuinely needs to be reassigned.

This is a default, not an absolute rule. The simulation core mutates copies internally for performance (see [`determinism-rules.md`](determinism-rules.md), Rule 6). The contract at the function boundary is what matters.

## Naming conventions

| Kind | Convention | Example |
|---|---|---|
| Files | `kebab-case.ts` | `wire-protocol.ts` |
| Folders | `kebab-case/` | `src/sim/`, `src/net/` |
| Type aliases and interfaces | `PascalCase` | `GridState`, `Player`, `Inputs` |
| Variables, functions, parameters | `camelCase` | `simulateTick`, `currentPlayer` |
| Constants (compile-time) | `SCREAMING_SNAKE_CASE` | `MAX_NEIGHBORHOOD_SIZE`, `TICK_RATE_MS` |
| Boolean variables and functions | `is`, `has`, `can`, `should` prefix | `isAlive`, `hasJoined`, `canRespawn` |
| Private/internal helpers | leading underscore avoided; just don't export | `function processInput(...)` (not exported) |

Don't use Hungarian notation. Don't suffix interfaces with `I` (`IPlayer` is wrong; `Player` is right). Don't use `T`-prefixed type parameters (`TKey` is wrong; `K` or `Key` is right).

## File organization

A typical file looks like this:

```ts
// 1. Imports, sorted: node built-ins, then third-party, then internal (relative).
import { readFile } from 'node:fs/promises';
import { joinRoom } from 'trystero/nostr';
import type { GridState } from '../sim/state';
import { simulateTick } from '../sim/tick';

// 2. Constants used by this file.
const TICK_RATE_MS = 100;

// 3. Type definitions used only by this file (else they go in a co-located types file).
type LocalState = { ... };

// 4. The exported public API of the module.
export function startNetcode(...): ... { ... }

// 5. Internal helpers (not exported), in the order they are first used.
function processIncomingMessage(...) { ... }
function broadcastInputs(...) { ... }
```

Imports are sorted into three groups separated by blank lines: Node built-ins, third-party packages, and internal relative imports. Within each group, sort alphabetically.

Type-only imports use `import type` (enforced by `verbatimModuleSyntax`).

## Functions

- **Prefer function declarations over arrow functions** for top-level definitions. They hoist, they have a name, they are easier to debug.
- **Arrow functions are fine** for callbacks, short helpers, and inline expressions.
- **Functions that return promises end with `Async`** only when the same module also has a synchronous version. Don't add `Async` everywhere — it's noise.
- **Single-purpose functions.** A function does one thing. If you find yourself writing "and" in the function name (`processAndValidate`), split it.
- **Early returns are preferred over deep nesting.** Guard clauses at the top, then the main path.

## Error handling

Three error categories, three handling patterns. The full discipline is in [`errors-and-boundaries.md`](errors-and-boundaries.md). The short version:

- **Programming errors** (a function was called with wrong types, an invariant was violated): throw an `Error` and crash. Do not handle.
- **Validation errors** (untrusted input is malformed): throw a typed `ValidationError` at the trust boundary. Caller decides what to do.
- **Expected operational errors** (a peer disconnected, a file is missing): return a `Result<T, E>` type or use a typed error object. Don't throw.

Custom error classes extend `Error` and set `name` correctly:

```ts
export class ProtocolError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'ProtocolError';
  }
}
```

## Comments

Comments are for **why**, not **what**. The code is the *what*; the comment is the *reasoning*.

- **No comments that restate the code.** `// increment counter` next to `counter++` is noise.
- **Comments that explain non-obvious decisions are welcome.** "// We sort here even though it's redundant because the eventual Python port doesn't preserve insertion order."
- **No commented-out code.** If it's not needed, delete it. Git remembers.
- **No `TODO` or `FIXME` without an issue link.** If a thing should be done later, file an issue. Comments rot; issues don't.
- **JSDoc only on the public API of a module.** Internal helpers don't need it. Public exports get a one-paragraph JSDoc explaining what they do and any non-obvious constraints.

## Formatting

Formatting is **automated** and not a topic of debate. The project uses Prettier with this config:

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2,
  "useTabs": false,
  "arrowParens": "always",
  "endOfLine": "lf"
}
```

If you find yourself adjusting whitespace by hand, run `npm run format` instead.

## Linting

The project uses **ESLint** (or Biome — pick one and stick with it; my recommendation is Biome for v0.1 because it's faster and configures itself). The lint rules layer on top of TypeScript strict mode and add:

- No unused imports.
- No unused variables (with `_`-prefix exception for intentional unused).
- Consistent return types on exported functions.
- No `console.log` outside `src/cli/` (use a structured logger or stderr).
- The simulation-boundary rule: nothing in `src/sim/` may import from outside `src/sim/`.

The lint must pass before merging. Disabled lint rules (with `// eslint-disable-next-line`) require a comment explaining why.

## Imports of Node built-ins

Always use the `node:` prefix for Node built-ins (`node:fs`, `node:path`, `node:crypto`). This makes it explicit that the import is a built-in and prevents accidental shadowing by a third-party package.

## ECMAScript modules only

GRID is ESM. No CommonJS, no `require()`, no `module.exports`. The `package.json` has `"type": "module"`. All imports use ES module syntax.

When importing local files, **include the `.js` extension** even though the source files are `.ts`:

```ts
// ✅ RIGHT
import { simulateTick } from '../sim/tick.js';

// ❌ WRONG
import { simulateTick } from '../sim/tick';
```

This is required for ESM module resolution under Node. TypeScript handles the `.ts` → `.js` mapping at compile time.

## Things explicitly not enforced

To save time on debates that don't matter:

- Whether to use single or double quotes (Prettier picks).
- Whether to use semicolons (Prettier picks: yes).
- Whether to use `function` or `const f = () =>` (use whichever fits the situation).
- Whether to put types in a separate `types.ts` file (co-locate by default; split when a file gets too long).
- Whether to use named or default exports (prefer named; default is fine for the entry point of a CLI).

If a question isn't covered by this document and isn't enforced by a tool, **just pick one and be consistent within the file**. Code style debates are time pollution.
