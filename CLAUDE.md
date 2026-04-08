# CLAUDE.md — engineering entry point

You are working on **GRID**, a small decentralized terminal-native game-world. This file is the entry point for AI coding agents working on the GRID *implementation*. It is loaded into every coding session. Read it before doing any work.

> **Not to be confused with `AGENTS.md`** (also at the project root). That file is the *daemon authoring* reference — it's prompt context for the `npx grid forge` command and for AI assistants helping daemon authors. It is not engineering guidance for working on GRID itself. If you are here to write GRID code, ignore `AGENTS.md` and read this file plus `docs/engineering/`.

## What GRID is, in three lines

GRID is a decentralized terminal-native multiplayer game where players inhabit a shared neon grid by piloting light cycles or by writing daemons that drive cycles for them. It runs over WebRTC peer-to-peer mesh with no server. The simulation is deterministic lockstep, and that property is **load-bearing** — if you break determinism, nothing else works.

For the full concept, read [`docs/concept/vision.md`](docs/concept/vision.md). For the build plan, read [`docs/roadmap.md`](docs/roadmap.md).

## Project map

```
/                              project root
├── CLAUDE.md                  ← this file (engineering entry point)
├── AGENTS.md                  ← daemon authoring reference (NOT engineering)
├── package.json               ← npm package definition
├── src/
│   ├── sim/                   ← THE SIMULATION. Pure, deterministic, no I/O. See determinism-rules.md.
│   ├── net/                   ← P2P networking, Trystero, Nostr signaling, lockstep transport
│   ├── render/                ← terminal rendering, box-drawing, ANSI color
│   ├── ui/                    ← keyboard input, intro animation, exit epitaph
│   ├── id/                    ← identity derivation (USER@HOSTNAME, color hash)
│   ├── persist/               ← daily grid persistence, midnight reset, archive writes
│   └── cli/                   ← `npx grid` entry point, argument parsing, top-level wiring
├── test/
│   ├── sim/                   ← determinism tests, property-based tests
│   ├── net/                   ← protocol tests, fake-peer tests
│   └── e2e/                   ← end-to-end smoke tests
└── docs/
    ├── concept/               ← what GRID is (vision, pillars)
    ├── design/                ← gameplay, goals, identity, forge
    ├── architecture/          ← networking, determinism, persistence (the WHY)
    ├── protocol/              ← wire-protocol, daemon-api (the WHAT, byte-for-byte)
    ├── engineering/           ← engineering rules (THIS folder is the HOW you write code)
    └── roadmap.md             ← v0.1 scope, build stages, risks
```

The most important rule about this map: **`src/sim/` is the simulation boundary**. Code inside `src/sim/` is held to stricter rules than code outside it. See [`docs/engineering/architecture-principles.md`](docs/engineering/architecture-principles.md) and [`docs/engineering/determinism-rules.md`](docs/engineering/determinism-rules.md) for what that means in practice.

## The ten rules every session must follow

These are the rules you should obey on every task without being reminded. If a task seems to require violating one of them, stop and ask before proceeding.

1. **Never put I/O, randomness, time, or environment access inside `src/sim/`.** The simulation is a pure function. Anything that touches the outside world goes in `src/net/`, `src/persist/`, `src/ui/`, or `src/cli/` — never in `src/sim/`.
2. **Never use floating-point arithmetic in `src/sim/`.** Positions, ages, decay timers, probabilities — everything is integer. If you need a probability, use a fixed-point ratio.
3. **Never call `Math.random()`, `Date.now()`, `performance.now()`, or `process.env` inside `src/sim/`.** The simulation has its own clock (the tick number) and its own RNG (a seeded PCG state that lives in the simulation state itself).
4. **Iterate sorted, always.** Whenever simulation code iterates a Map, Set, or object, iterate it in a deterministic sorted order keyed by something stable (player ID, cell coordinates). Never rely on insertion order. Non-determinism enters through unsorted iteration more often than any other source.
5. **Validate at boundaries, trust internally.** Network input, daemon input, and file input are *untrusted* and validated immediately at the boundary module that received them. Once validated, internal code trusts the data and doesn't re-check. See [`docs/engineering/errors-and-boundaries.md`](docs/engineering/errors-and-boundaries.md).
6. **Don't add a dependency without justification.** Every `npm install` is a permanent decision. New dependencies require a one-line note in `docs/engineering/dependencies.md` explaining what they replace. Standard library and Node built-ins are always preferred. See [`docs/engineering/dependencies.md`](docs/engineering/dependencies.md).
7. **Read the relevant `docs/` before changing related code.** If you are touching networking, read `docs/architecture/networking.md` and `docs/protocol/wire-protocol.md` first. If you are touching the simulation, read `docs/architecture/determinism.md`. Specs are normative; if code disagrees with a spec, the spec is the source of truth and the code is the bug.
8. **Don't add features beyond what was requested.** No bonus refactors, no "while I'm here" cleanups, no defensive features for hypothetical future needs. The single biggest cause of regressions is doing more than was asked. If you notice something unrelated that needs fixing, mention it; do not silently fix it.
9. **Every change to the simulation runs the determinism CI test before being committed.** Cross-platform hash comparison is the smoke test that catches every broken determinism change. If the test isn't passing locally, the change is not done.
10. **Prefer small focused commits.** One concept per commit. The commit message explains the *why*, not the *what* (the diff is the what). Conventional commit format is used (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`).

## Workflow checkpoints

Before starting a task:
- Read this file (you are doing that now).
- Read the relevant `docs/` for the area you're touching (see rule 7).
- If you'll touch the simulation, also read [`docs/engineering/determinism-rules.md`](docs/engineering/determinism-rules.md).
- If you'll touch the protocol, also read [`docs/protocol/wire-protocol.md`](docs/protocol/wire-protocol.md).

While working:
- Run unit tests after each meaningful change. They are fast.
- Run the determinism CI smoke test after any change in `src/sim/`.
- Don't commit until all tests pass and the change is scoped to one concept.

Before declaring a task done:
- All tests pass.
- No new dependencies were added without a note in `dependencies.md`.
- Any spec change has a matching code change, and vice versa.
- The change is scoped to what was asked, with no extras.

## The detail files (read on demand)

The full engineering rules live in [`docs/engineering/`](docs/engineering/). Read the relevant file when you start work in that area:

- [`architecture-principles.md`](docs/engineering/architecture-principles.md) — layered architecture, the simulation boundary, dependency direction
- [`determinism-rules.md`](docs/engineering/determinism-rules.md) — the non-negotiable rules for code in `src/sim/`
- [`code-style.md`](docs/engineering/code-style.md) — TypeScript conventions, naming, formatting, comment discipline
- [`testing.md`](docs/engineering/testing.md) — test layers, property-based tests, the cross-platform determinism CI
- [`errors-and-boundaries.md`](docs/engineering/errors-and-boundaries.md) — where to validate, where to trust, error types
- [`dependencies.md`](docs/engineering/dependencies.md) — the dependency policy, the audit trail, banned categories
- [`performance.md`](docs/engineering/performance.md) — the tick budget, hot paths, allocation discipline

You do not need to read all of these on every session. Read the file that matches the work you are about to do.

## When in doubt

- If a rule conflicts with another rule, **the simulation rules in `determinism-rules.md` win**. Determinism is the foundation; everything else can be revised.
- If a spec disagrees with the code, **the spec wins**. Fix the code, not the spec.
- If a task seems to require violating one of the ten rules above, **stop and ask**. Don't silently work around the rule.
- If you don't know which engineering doc covers your situation, **read `docs/engineering/README.md`** for the index.
