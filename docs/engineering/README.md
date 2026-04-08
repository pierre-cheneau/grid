# Engineering rules

This folder contains the **detailed coding and architectural rules** for the GRID implementation. These files are the *normative reference* for how to write GRID code. The short version lives in [`../../CLAUDE.md`](../../CLAUDE.md) at the project root; this folder is the deep version, organized by concern.

You should not read all of these on every coding session. Read the file that matches the work you are about to do. The root `CLAUDE.md` is the only file loaded into every session.

## Index

| File | When to read it |
|---|---|
| [`architecture-principles.md`](architecture-principles.md) | Before adding a new module, before changing module boundaries, before any structural refactor. |
| [`determinism-rules.md`](determinism-rules.md) | **Before any change inside `src/sim/`.** This is the most safety-critical doc in the project. |
| [`code-style.md`](code-style.md) | Before writing your first GRID code. Once internalized, you only revisit when the rules change. |
| [`testing.md`](testing.md) | Before adding a new test, before changing the CI configuration, before debugging a flaky test. |
| [`errors-and-boundaries.md`](errors-and-boundaries.md) | Before adding code that handles untrusted input (network messages, daemon output, file I/O, user input). |
| [`dependencies.md`](dependencies.md) | Before adding a new npm package. Always. No exceptions. |
| [`performance.md`](performance.md) | Before optimizing anything. Also before *not* optimizing something you suspect is slow. |

## How these rules relate to the rest of `docs/`

- **`docs/concept/`** — *what GRID is* (philosophy)
- **`docs/design/`** — *what GRID does* (gameplay, goals, identity)
- **`docs/architecture/`** — *how GRID works* (networking, determinism, persistence — the system view)
- **`docs/protocol/`** — *what GRID says on the wire* (byte-level specs)
- **`docs/engineering/`** ← you are here — *how GRID code is written* (rules for the implementation)
- **`docs/roadmap.md`** — *what GRID ships* (scope, build stages, risks)

The architecture docs explain *why* the system works the way it does. The engineering docs explain *how to write code that doesn't break those properties*. Read both when in doubt.

## Versioning these rules

These rules are not immutable. They are the current best understanding and they will evolve as the project does. The bar for changing a rule:

- A clear example of where the rule is wrong, harmful, or paid for in real time.
- A proposed new rule that is at least as concrete and verifiable as the old one.
- A note in the commit message explaining what changed and why.

The rules in [`determinism-rules.md`](determinism-rules.md) have an additional bar: they cannot be changed without a corresponding update to the cross-platform determinism CI test, and a clear demonstration that the new rules still produce bit-identical simulation across machines. Determinism is non-negotiable; the rules that protect it can be revised but the property cannot.
