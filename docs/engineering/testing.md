# Testing strategy

How GRID is tested. The strategy is built around one observation: **the simulation core is the most important thing to test, the most testable thing in the project, and the most catastrophic thing to break**. So most of the testing budget goes there.

## The three layers

GRID uses three layers of automated tests, each catching a different class of bugs.

### Layer 1: unit tests (run constantly)

Standard unit tests of pure functions. Fast (~ms per test), run on every commit, run continuously by the developer's editor.

**What gets unit-tested:**

- Every function in `src/sim/`. The simulation core is pure and easy to test in isolation. **Coverage target: 100%** of branches in `src/sim/`. The bar is high here because this is the load-bearing code.
- Every function in `src/id/`, `src/persist/`, `src/render/` that doesn't require I/O.
- Type guards and validators in boundary modules.

**What does not get unit-tested:**

- Functions that exist only to wire I/O together (e.g., the `main()` in `src/cli/`).
- Trivial getters and setters (there shouldn't be many).
- Functions whose only behavior is to call another function (delete the wrapper instead).

**Test framework:** Node's built-in test runner (`node --test`) is the default. It is fast, has zero dependencies, and is good enough. If a feature it lacks becomes important, switch to Vitest. Do not use Jest (slow, heavy, ESM-hostile).

**File layout:** tests live in `test/`, mirroring the `src/` layout. `src/sim/decay.ts` has `test/sim/decay.test.ts`.

**Test naming:** describe what the function does, not how. `it('decays trail cells over time')` is good. `it('returns nextState with cell.age incremented')` is bad.

### Layer 2: property-based tests (run before push)

Property-based tests generate **random sequences of inputs** and verify that the simulation has certain *properties* regardless of the specific inputs. They catch the bugs unit tests miss because unit tests only check the cases the developer thought of.

**The properties that must hold:**

1. **Determinism.** Running `simulateTick` twice with identical state and inputs produces identical outputs. (This is the smoke test for the determinism rules.)
2. **Idempotency of replay.** Given a sequence of inputs, running them forward produces the same final state as starting fresh and replaying the recorded inputs.
3. **State hash equivalence.** Two states that are equal by deep comparison must have the same canonical hash, and vice versa.
4. **No mutation of inputs.** After `simulateTick(state, inputs)` returns, neither `state` nor `inputs` has been observably modified from the caller's point of view.
5. **Tick monotonicity.** `nextState.tick === state.tick + 1` always.
6. **Conservation laws.** Cells don't appear from nowhere (every cell in `nextState` was either in `state` or was placed by an input this tick); cells don't disappear except by decay or collision.

**Test framework:** [fast-check](https://github.com/dubzzz/fast-check) is the standard property-based testing library for TypeScript. Use it.

**File layout:** property tests live in `test/sim/properties/`. They are slower than unit tests (~seconds per property) so they are not run on every save, but they run on every push and in CI.

**When to add a property:** when fixing a determinism bug, add a property test that would have caught it. The bug was found because *some* sequence of inputs hit it; a property test exercises many more sequences.

### Layer 3: cross-platform determinism CI (run on every push)

The most important test in the project. The CI workflow runs the **same simulation script** on Linux and Windows in parallel, computes the canonical state hash at the end, and **fails the build if the hashes differ**.

**What it tests:** that the simulation produces bit-identical results on different platforms. This is the only test that catches platform-dependent non-determinism (which is the worst kind, because it doesn't show up locally).

**How it works:**

```yaml
# .github/workflows/determinism.yml (sketch)
jobs:
  determinism:
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npm run determinism:hash > hash.txt
      - uses: actions/upload-artifact@v4
        with:
          name: hash-${{ matrix.os }}
          path: hash.txt

  compare:
    needs: determinism
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
      - run: |
          ubuntu_hash=$(cat hash-ubuntu-latest/hash.txt)
          windows_hash=$(cat hash-windows-latest/hash.txt)
          if [ "$ubuntu_hash" != "$windows_hash" ]; then
            echo "DETERMINISM BROKEN: ubuntu=$ubuntu_hash windows=$windows_hash"
            exit 1
          fi
```

**The simulation script** runs a fixed scenario for a fixed number of ticks with a fixed seed and prints the state hash. It is checked into the repo as `scripts/determinism-hash.ts`.

**Set this up in stage 1.** Before the simulation has any complexity at all. Once it's in place, every subsequent change has automatic protection. If you wait until the simulation is complex, finding the source of a divergence becomes a multi-day investigation.

**Never disable this test.** Never mark it flaky. Never merge a PR with this test failing. A failure here is the loudest possible alarm and must be investigated immediately.

## What does not get tested (and why)

Some things in GRID are deliberately not unit-tested.

**The rendering output.** Snapshot-testing terminal escape sequences is brittle, low-value, and slow. The renderer is verified by manual play during development and by occasional `--render-frames` regression captures. If a regression occurs in the renderer, add a targeted test for *that* regression; don't try to test the renderer comprehensively.

**The intro animation.** Same reason. It's verified by eye.

**Trystero, Nostr, WebRTC.** Third-party libraries are not retested. We trust them at the boundary and validate the messages they hand us (see [`errors-and-boundaries.md`](errors-and-boundaries.md)).

**End-to-end multi-machine play.** This is tested manually before each release: open `npx grid` on three real machines, play for 10 minutes, verify no desyncs. Automating multi-machine WebRTC tests is far more work than the bug-catching value justifies.

## What does NOT get mocked

Mocking is permitted but discouraged. The tests that matter most (the simulation tests) need no mocks at all because the simulation has no I/O.

**Never mock:**

- The simulation itself. If you find yourself wanting to mock `simulateTick`, you're testing the wrong thing.
- The PRNG. Use a fixed seed instead. Deterministic, repeatable, no mock framework needed.
- The system clock inside the simulation. The simulation has no clock. If you're tempted to mock the clock, you're touching code that violates Rule 3 of the determinism rules.
- Network code in unit tests. If a test needs the network, it's an integration test and belongs in `test/net/` with real fake peers.

**Mocking is fine for:**

- Filesystem reads in tests of `src/persist/`. Use Node's built-in `fs.promises` mocked or use a temp directory.
- The terminal in tests of `src/render/`. Render to an in-memory buffer and assert on the bytes.
- Third-party libraries at integration boundaries, when running them against a real instance is impractical.

## Test organization

```
test/
├── sim/
│   ├── decay.test.ts           ← unit tests for decay
│   ├── tick.test.ts            ← unit tests for the tick function
│   ├── rng.test.ts             ← unit tests for the PRNG
│   ├── serialize.test.ts       ← canonical serialization tests
│   └── properties/
│       ├── determinism.test.ts ← property: simulation is deterministic
│       ├── replay.test.ts      ← property: replay equivalence
│       └── conservation.test.ts ← property: cells don't appear/disappear arbitrarily
├── net/
│   ├── wire.test.ts            ← protocol message parsing/serialization
│   └── lockstep.test.ts        ← lockstep input collection with fake peers
├── render/
│   └── grid.test.ts            ← render to in-memory buffer, assert bytes
└── e2e/
    └── smoke.test.ts           ← optional: spawn the CLI as a subprocess and check it starts
```

## Test conventions

- **Tests are pure where possible.** A test that doesn't touch I/O can run in parallel with any other test.
- **Tests don't share state.** Each test sets up its own fixtures.
- **Tests have a single assertion focus.** Multiple assertions are fine if they verify aspects of the same behavior; use `it()` blocks to separate distinct behaviors.
- **Tests describe behavior, not implementation.** When the implementation changes, the test should still pass if the behavior is preserved.
- **Tests fail loudly.** A failed test prints what was expected, what was received, and the inputs that produced the failure.

## Running the tests

```bash
npm test                # all tests, fast layer (unit + boundary)
npm run test:property   # property-based tests (slower, run before push)
npm run test:all        # everything except the cross-platform CI
npm run determinism:hash  # the cross-platform smoke test, locally
```

The pre-commit hook (if installed) runs `npm test` automatically. The pre-push hook runs `npm run test:all`. Neither hook is required, but both are recommended.

## When to write the test

Default: **before the code**. Write the test that captures the behavior you want, watch it fail, then write the code that makes it pass. This is TDD.

Pragmatic exception: **when exploring**. If you're not sure what the API should look like, prototype the code first, then write tests once the shape stabilizes. Don't let TDD get in the way of figuring out a hard problem.

Non-negotiable: **when fixing a bug**. The fix has a test that fails before the fix and passes after. No exceptions. Bugs that don't have tests come back.
