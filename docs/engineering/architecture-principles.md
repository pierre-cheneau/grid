# Architecture principles

The rules that shape how GRID's code is structured. Read this before adding a new module, changing a module boundary, or doing any structural refactor.

## The one rule

> **The simulation is a pure function. Everything else is an adapter that talks to it.**

If you understand this single rule, you understand the entire architecture. The rest of this document is the unpacking of what that means in practice.

## Layered architecture

GRID is organized in concentric layers. **Dependencies point inward.** Outer layers may import from inner layers; inner layers may not import from outer layers, ever.

```
                    ┌─────────────────────────────┐
                    │   src/cli/                  │  ← top-level: argv, env, main()
                    │   (argv, dotfiles, exit)    │
                    └──────────┬──────────────────┘
                               │
        ┌──────────────────────┼──────────────────────┐
        │                      │                      │
        ▼                      ▼                      ▼
   ┌─────────┐           ┌──────────┐          ┌──────────┐
   │ src/ui/ │           │ src/net/ │          │src/render│   ← I/O adapters
   │ (input) │           │ (P2P)    │          │ (output) │
   └────┬────┘           └────┬─────┘          └────┬─────┘
        │                     │                     │
        │  ┌──────────────────┼─────────────────────┘
        │  │                  │
        ▼  ▼                  ▼
   ┌─────────┐          ┌──────────┐
   │ src/id/ │          │src/persist│   ← supporting domains (still adapters)
   │(identity│          │ (archive)│
   └────┬────┘          └────┬─────┘
        │                    │
        └──────────┬─────────┘
                   ▼
              ┌─────────┐
              │ src/sim/│   ← THE CORE. Pure. Deterministic. No I/O.
              │  (the   │
              │simulation)│
              └─────────┘
```

### Layer responsibilities

| Layer | Responsibility | May import from |
|---|---|---|
| `src/sim/` | The deterministic game simulation. Pure functions, no I/O. | Nothing inside `src/`. |
| `src/id/` | Identity derivation: USER@HOSTNAME, color hashing, identity cache. | `src/sim/` (for type definitions only). |
| `src/persist/` | Cell snapshot encoding/decoding, local file backup (`~/.grid/`), hash chain computation, compression. | `src/sim/`, `src/id/`. |
| `src/render/` | Terminal rendering, box-drawing, ANSI color, intro animation. | `src/sim/`, `src/id/`. |
| `src/ui/` | Keyboard input, raw mode, exit handling, the spectator overlay. | `src/sim/`, `src/render/`. |
| `src/net/` | P2P networking, Nostr relay pool, WebRTC signaling, spatial tiles, proximity topology, lockstep transport, peer eviction, Nostr persistence (cell snapshots, chain attestation, world config). | `src/sim/`, `src/id/`, `src/persist/`. |
| `src/daemon/` | Daemon subprocess bridge (`--deploy`), in-process worker model, handshake/tick loop, forge command. | `src/sim/`, `src/net/`. |
| `src/cli/` | Top-level wiring: argument parsing, environment, the `main()` entry, signal handling. | All of the above. |

### Why this shape

This is a **functional core, imperative shell** layout (Gary Bernhardt). The functional core (`src/sim/`) is small, pure, deterministic, easy to test, and has no dependencies. The imperative shell wraps it with everything that touches the outside world. This shape is what makes GRID's lockstep simulation work — and it's also what makes GRID's tests fast, the determinism CI tractable, and the daemon API trivial to implement.

Specifically, this layering enables:

- The simulation can be tested in isolation, with synthetic inputs and no I/O setup.
- The simulation can be run identically on every peer, because nothing it touches is platform-specific.
- The simulation can be replayed from a recorded input log, because it has no hidden state from the environment.
- New transport layers (a different P2P library, a debug visualizer, a replay player) can be added without touching the core.
- Each layer can be tested independently of the layers above it.

## The simulation boundary

`src/sim/` is the **simulation boundary**. Code inside it follows stricter rules than code anywhere else in the project. Specifically, code inside `src/sim/`:

- **Cannot import** anything from `src/net/`, `src/render/`, `src/ui/`, `src/persist/`, `src/cli/`, or `src/id/`. The simulation knows nothing about these layers exist.
- **Cannot import** anything from Node's standard library that performs I/O: no `fs`, no `net`, no `child_process`, no `os`, no `process` (except for type imports).
- **Cannot use** `Math.random()`, `Date.now()`, `performance.now()`, `process.hrtime()`, or any other source of nondeterministic input.
- **Cannot read** environment variables.
- **Cannot use** floating-point arithmetic.

The full list of rules and the reasoning behind each one is in [`determinism-rules.md`](determinism-rules.md). This document only states *that* the boundary exists and *where* it is.

The boundary is enforced two ways:

1. **By convention.** This document and `determinism-rules.md` make the rules explicit. Code review checks them.
2. **By an automated lint rule.** A dependency-cruiser (or equivalent) configuration in CI fails the build if a file in `src/sim/` imports anything outside `src/sim/`. This is the most important automated check in the project. Set it up early.

## Module size and shape

These are guidelines, not absolute rules. Use judgment.

- **Files should fit in a single screen.** ~200 lines is the soft cap; ~400 lines is the hard cap. A file that exceeds 400 lines is doing too many things and should be split.
- **Functions should fit in a single thought.** ~30 lines is the soft cap. A function that exceeds 60 lines is doing too many things. Extract.
- **Modules should expose a small surface.** A module with 20 exports is doing too much. Split it.
- **Internal helpers stay internal.** If a function is only used inside one file, do not export it. Reducing the public API of a module is one of the best refactors you can do.
- **Don't create files just for symmetry.** A `types.ts` file with one type definition is worse than putting the type next to the code that uses it. Co-locate aggressively until that fails.

## Dependency direction rules

Beyond the layer rules above, two finer rules:

1. **Types may flow upward.** A lower layer may export type definitions that an upper layer consumes. This is the only way information passes up.
2. **Functions never flow downward.** A higher layer may not pass a callback to a lower layer that gets called inside that lower layer. The simulation does not call out into anything; it only returns new state. Inversion of control across the boundary breaks determinism.

If you find yourself wanting to pass a callback from `src/cli/` into `src/sim/`, the design is wrong. Stop and think about how to invert it.

## Pure functions: what counts and what doesn't

Code in `src/sim/` is "pure." This is a precise term:

A function is **pure** if:

- Given the same arguments, it returns the same value, every time.
- It has no side effects (no I/O, no mutation of arguments, no mutation of global state).
- It does not throw based on environmental conditions (only based on its arguments being malformed, which is a programming error, not a runtime condition).

A function is **not** pure if it:

- Reads from disk, the network, environment variables, or the system clock.
- Calls `Math.random()` or any other unseeded RNG.
- Mutates an argument that the caller still holds a reference to.
- Logs to stdout or stderr (yes, even logging).
- Throws different errors on different machines for the same inputs.

The simulation may **internally** mutate copies for performance (lockstep simulation often does in-place updates for speed). The *contract* is purity: callers see a function that takes a state and returns a new state, even if the implementation reuses memory.

## How to add a new module

When you need to add code that doesn't fit into an existing module:

1. **Decide which layer it belongs in.** Apply the layer responsibilities table above. If the answer isn't obvious, the new code probably crosses layers and needs to be split.
2. **Choose a directory.** Either an existing one (`src/net/`, `src/render/`, etc.) or a new sibling. New top-level directories under `src/` are rare and should be discussed.
3. **Define its public surface first.** What does it export? What does it need from other modules? Write the type signatures before the implementation.
4. **Verify the dependency direction.** Does anything in your new module import from a higher layer? If yes, the design is wrong; redesign before writing code.
5. **Write tests in the parallel `test/` directory.** A new `src/sim/decay.ts` gets `test/sim/decay.test.ts`.

## What to do when these principles conflict with reality

These principles are the default. There will be edge cases where following them strictly produces worse code than bending them. When that happens:

- **Document the deviation.** A comment in the code explaining why the principle is being bent, and a note in the relevant docs explaining why.
- **Make it the smallest possible deviation.** If you have to break the simulation boundary for one specific reason, isolate that reason in one tiny module that everyone can see and audit.
- **Discuss before merging.** A deviation from these principles is a design decision, not a tactical choice. It deserves explicit thought.

The principles exist to make most decisions easy. They are not bureaucracy. When they get in the way of good code, the right answer is usually to revisit the principle, not to silently break it.
