# Errors and trust boundaries

The discipline for handling errors and untrusted input. The principle is simple: **validate at the boundary, trust internally**. Most of this document is the unpacking of what that means in practice.

## The principle

GRID has several places where data crosses from "outside" (untrusted) to "inside" (trusted). At each crossing, the data is validated immediately and either accepted (transformed into a typed internal representation) or rejected (with a clear error). Once validated, internal code does not re-check.

The trust boundaries are:

1. **Network input.** Messages from peers via WebRTC. Untrusted: a peer might send malformed JSON, lies about its identity, or attempt protocol exploits.
2. **Daemon stdout.** Output from a daemon subprocess (or the in-process worker for forged daemons). Untrusted: a daemon might crash, produce malformed JSON, or violate the protocol.
3. **File reads.** Reading the identity cache, the daemon directory, or any other file from disk. Untrusted: the file might be corrupt, missing, or written by an old version.
4. **Environment and arguments.** `process.env`, `process.argv`. Untrusted: the user might pass garbage.
5. **The terminal.** Keyboard input from the user in pilot mode. Untrusted in the technical sense (the user might press anything), but the input vocabulary is so small that "untrusted" mostly means "ignore unrecognized keys."

Inside each boundary, code is **trusted** and operates on validated, typed data. The simulation core, in particular, never validates anything — it assumes its inputs are well-formed because they were validated by whatever module called it. This is what makes the simulation core small and fast.

## Three error categories

GRID code distinguishes three categories of errors. Each has its own handling pattern.

### Category 1: programming errors

A function was called incorrectly, an invariant was violated, an assumption was wrong. These are bugs and they should crash loudly and fast.

**Pattern: throw a plain `Error` and crash.**

```ts
function getCellAt(state: GridState, x: number, y: number): Cell {
  if (x < 0 || x >= state.config.gridW) {
    throw new Error(`programming error: x=${x} out of bounds [0..${state.config.gridW})`);
  }
  // ...
}
```

These errors should never reach a user. They mean the developer made a mistake. The right response is a stack trace and a crash, in development and in production. **Do not catch programming errors and try to recover.** Recovery hides bugs.

### Category 2: validation errors at trust boundaries

Untrusted input was malformed. The right response is to reject the input (often by ignoring it) and possibly to log the rejection for debugging.

**Pattern: typed `*Error` classes that the boundary handler catches.**

```ts
export class ProtocolError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'ProtocolError';
  }
}

// At the network boundary:
function handleIncomingMessage(raw: string) {
  try {
    const parsed = parseMessage(raw); // throws ProtocolError if malformed
    routeToSimulation(parsed);
  } catch (err) {
    if (err instanceof ProtocolError) {
      // Log, increment a counter, possibly evict the peer after N failures.
      logger.warn('protocol error from peer', { err: err.message });
      return;
    }
    throw err; // re-throw anything else; we don't know how to handle it.
  }
}
```

Validation errors are *expected* at runtime. The system handles them and continues. They are not bugs.

### Category 3: expected operational errors

A peer disconnected. A file is missing. An optional config wasn't found. These are normal events and the code should handle them gracefully without exceptions.

**Pattern: explicit return types, not exceptions.**

```ts
type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

async function loadIdentity(): Promise<Result<Identity, 'not_found' | 'corrupt'>> {
  try {
    const raw = await readFile(IDENTITY_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!isValidIdentity(parsed)) return { ok: false, error: 'corrupt' };
    return { ok: true, value: parsed };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ok: false, error: 'not_found' };
    }
    throw err; // unexpected I/O error — treat as programming error
  }
}
```

`Result` types make the failure modes explicit in the function signature. The caller cannot forget to handle them. This is much safer than throwing for normal-flow errors.

## Validation at boundaries: the patterns

### Network messages

Every incoming message is parsed, validated, and tagged with its type *before* it reaches the simulation:

```ts
// src/net/wire.ts
import type { Message } from './types.js';

export function parseMessage(raw: string): Message {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ProtocolError('malformed JSON');
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new ProtocolError('message is not an object');
  }

  if (!('t' in parsed) || typeof parsed.t !== 'string') {
    throw new ProtocolError('missing or invalid type field');
  }

  if (!('v' in parsed) || parsed.v !== 1) {
    throw new ProtocolError('unsupported protocol version');
  }

  switch (parsed.t) {
    case 'INPUT': return parseInput(parsed);
    case 'STATE_HASH': return parseStateHash(parsed);
    // ...
    default: throw new ProtocolError(`unknown message type: ${parsed.t}`);
  }
}
```

Each parser returns a strongly-typed message or throws. Code that receives the result has no `unknown` left to deal with.

### Daemon output

Daemon stdout is parsed the same way as network messages, with similar validation:

```ts
// src/net/daemon-bridge.ts
function handleDaemonLine(raw: string): DaemonCmd {
  // same pattern as parseMessage, returning a typed DaemonCmd or throwing.
}
```

A daemon that produces 10 consecutive parse failures is killed. A pilot keypress that's unrecognized is ignored silently.

### File I/O

File reads return `Result` types when failure is expected (e.g., the identity cache might not exist on first launch). They throw when failure is a programming error (e.g., the cache file exists but is unreadable due to permission issues — that's an environment problem, log and crash).

### Environment and arguments

CLI argument parsing is the only code that reads `process.argv`. CLI code lives in `src/cli/`. Parsed arguments are validated immediately and passed as a typed `CliConfig` object to everything else. Nothing else in the codebase touches `process.argv`.

Same for `process.env` (with the additional restriction that the simulation never touches it at all — see [`determinism-rules.md`](determinism-rules.md), Rule 5).

### Keyboard input

Keyboard input is read in raw mode from `process.stdin`. The set of recognized keys is small (arrow keys, WASD, hjkl, q, Tab, Space). Unrecognized bytes are silently ignored. There is no validation error to report — there is no concept of "wrong" keyboard input.

## Defensive coding: when not to do it

**Do not validate inside the trusted layer.** If the simulation core re-validates its inputs, you've doubled the validation cost and the risk of inconsistency between the two validators.

```ts
// ❌ WRONG — defensive overcoding
function simulateTick(state: GridState, inputs: Inputs): GridState {
  if (!state) throw new Error('state is null');
  if (state.tick < 0) throw new Error('tick is negative');
  if (typeof state.config.gridW !== 'number') throw new Error('gridW is not a number');
  // ... 30 more lines of input validation ...
  // ... actual simulation logic ...
}
```

The simulation trusts its inputs. If `state.tick` is negative, that's a programming error from somewhere upstream — the right response is to fix the upstream code, not to add a check.

```ts
// ✅ RIGHT — trust internally
function simulateTick(state: GridState, inputs: Inputs): GridState {
  // ... actual simulation logic ...
}
```

If you genuinely want a sanity check during development, use TypeScript's type system or an `assert()` macro that compiles out in production. Don't pollute production code with redundant checks.

## When `try/catch` is appropriate (and when it isn't)

`try/catch` is appropriate when:

- You are at a trust boundary and need to handle a validation failure.
- You are calling third-party code that throws on expected failures and you want to convert to a `Result`.
- You are at the top of a long-running loop (the netcode tick loop, the renderer frame loop) and you want to catch unexpected errors so the loop continues rather than crashing.

`try/catch` is NOT appropriate when:

- You want to "be safe" in case something might throw. If you don't know what would throw, you can't handle it correctly.
- You want to swallow an error you don't understand. Re-throw or let it propagate.
- You want to log the error and continue. Logging-and-continuing without understanding *why* the error happened is how silent corruption begins.

When in doubt, **don't catch**. An uncaught exception in development is a clear signal that something is wrong; a caught-and-logged exception is noise that everyone learns to ignore.

## Crash discipline

GRID crashes when something is genuinely wrong:

- Unexpected I/O errors (out of memory, broken disk).
- Programming errors (failed invariants, type assertion failures).
- Unrecoverable state corruption (the local state hash diverges from the rest of the mesh and we can't re-sync).

Crashing is the **correct response** to these. A crashed GRID prints a clear error message, leaves the player's terminal in a clean state (alternate-screen mode is exited, raw mode is disabled), and writes the epitaph if it can. Then it exits with a non-zero status code.

A GRID that *tries to recover* from these conditions is a GRID that loses player trust. Better to crash cleanly and let the player run `npx grid` again than to limp along producing wrong results.

## Top-level error handling

The CLI has exactly one top-level handler:

```ts
// src/cli/main.ts
async function main() {
  try {
    await run();
  } catch (err) {
    cleanupTerminal(); // exit raw mode, exit alternate screen, restore cursor
    console.error('GRID crashed:', err);
    process.exit(1);
  }
}
```

This handler exists *only* to clean up the terminal and print a useful error. It does not attempt to recover, retry, or continue. If `run()` throws, the session is over.

Inside `run()`, errors are handled at the boundary they belong to. Network errors are handled in the netcode loop. Validation errors are handled at the validation boundary. The top-level handler is only for the unhandled case, and the unhandled case means a bug.

## Logging

Logging is **not** an error-handling strategy. Logging tells the developer what happened; it does not change the behavior of the program.

- **`console.log` is forbidden outside `src/cli/`.** Use a structured logger or write to `stderr`.
- **The logger has levels:** `debug`, `info`, `warn`, `error`. Default is `info`. The `--debug` flag enables `debug`.
- **Logging at `info` level is rare in production.** GRID is a TUI application — every line of log noise messes up the display. Most logging is `debug` or written to a separate log file.
- **Log structured data, not strings.** `logger.warn('peer evicted', { peer: id, reason: 'hash_mismatch' })` is greppable; `logger.warn('Peer ' + id + ' evicted because hash mismatch')` is not.
- **Never log sensitive data.** Identity hashes are fine. Raw hostnames are fine (they're already public in the grid). API keys and secrets are forbidden — but GRID has none of these in v0.1, so this is preventative discipline.

## Summary

| Situation | Action |
|---|---|
| Untrusted input is malformed | Throw a typed `*Error` at the validation boundary; caller catches and handles |
| Expected operational failure | Return a `Result<T, E>` |
| Programming error (bug) | Throw a plain `Error` and crash |
| Unrecoverable state | Crash, clean up the terminal, exit non-zero |
| Inside the simulation, anywhere | **No validation, no try/catch, no recovery.** Trust the inputs. |
| At the CLI top level | Single try/catch for cleanup and a clear error message |
