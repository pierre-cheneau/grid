# Performance

The performance budgets and the discipline for meeting them. The principle: **performance is a feature, but premature optimization is a bug**. Most code doesn't need to be fast. The code that does need to be fast is identified by measurement, not by intuition.

## The budgets

GRID has hard performance budgets. These are the numbers everything else hangs on. If a budget is missed, the game becomes unplayable or unfair.

| Budget | Value | What it covers | Why it matters |
|---|---|---|---|
| **Tick budget** | 100 ms | One full simulation tick: input collection + simulation + state hash check + render | At 10 ticks/sec, missing the budget means visible stutter and lockstep delays for every other peer |
| **Daemon tick budget** | 50 ms | The time a daemon subprocess has to read its TICK message and respond with a CMD | Must fit inside the simulation tick budget with headroom for transport |
| **Intro animation duration** | ≤ 2,000 ms | The full digitization sequence from `npx grid` to "you are in the grid" | Must overlap with WebRTC handshake; longer feels like loading, shorter doesn't read as ritual |
| **First-paint deadline** | ≤ 5,000 ms | From `npx grid` to playable, on a clean machine with cached `npx` | The "ten seconds to play" pillar; the cache-cold first install is the slow case |
| **Memory footprint** | ≤ 64 MB | Resident memory of a running GRID client during normal play | GRID should run on a Raspberry Pi class machine. Bloat is a bug |
| **Steady-state network** | ≤ 5 KB/s | Per-peer outbound bandwidth in a full 6-peer mesh | Comfortably below any consumer connection; tighter is better |
| **CPU at idle (spectator)** | ≤ 5% of one core | When the player is just watching the grid | Spectating must not heat the laptop |
| **Daemon source size** | ≤ 4,096 B | Hard cap on daemon source files | The cap pillar; see `concept/pillars.md` |

These are not aspirations. They are the contract the implementation must meet. A change that violates a budget is a regression even if it doesn't break any tests.

## How the budgets are measured

Each budget has a **measurement command**, runnable locally and in CI:

```bash
npm run perf:tick           # measure simulation tick latency under load
npm run perf:memory         # measure resident memory after 5 minutes of play
npm run perf:network        # measure per-peer outbound bandwidth in a 6-peer test mesh
npm run perf:startup        # measure first-paint time from CLI invocation
```

If a budget is at risk, the corresponding command is run as part of the determinism CI on every push. A regression of more than 10% from baseline triggers a build warning; a regression that exceeds the budget triggers a build failure.

The baseline is captured the first time each command runs and committed to the repo as `perf/baselines.json`. The baseline is updated when an intentional change causes a measurable shift, and the update is reviewed.

## When to optimize

The default answer is **don't**. Almost all code in GRID doesn't need to be fast. The renderer redraws 1,000 cells at 10fps; that's nothing. The CLI parses argv once at startup; that's nothing. The persistence layer writes a small JSON file occasionally; that's nothing.

Optimize when:

1. **A budget is being missed.** Measured, not guessed.
2. **You are working in a known hot path.** The simulation tick function. The state hash computation. The renderer's diff loop. These are documented below.
3. **A profile shows the code is responsible for >5% of runtime in a measured scenario.** Profiles are captured with `node --prof` or the built-in `node:perf_hooks`, not with intuition.

Do **not** optimize when:

- It "feels slow." Measure first.
- Someone said "we should make this faster." Ask why and measure.
- You're refactoring and want to "improve performance while you're there." This is the single biggest source of bugs in the project. Don't.
- The code only runs once at startup. Even a 10× slowdown of startup-only code is invisible.

## Hot paths

The following code paths are known to be performance-sensitive. When working in them, measure before and after every change. Treat them with extra care.

### `simulateTick` (`src/sim/tick.ts`)

The simulation function runs 10 times per second, on every peer, on every machine. It is the single hottest path in the project. The performance budget is **about 5 ms per tick on a modest laptop**, leaving headroom for the rest of the tick budget (network, render, hash check).

Discipline in `simulateTick`:

- **No allocations in the inner loop.** Iterating cells should not create new objects per cell. Reuse buffers, mutate in place internally (the function's *contract* is purity, but its *implementation* may use scratch buffers).
- **No `Array.from()` or spread of large collections.** These allocate. Use indexed loops over the underlying maps.
- **Pre-compute lookups outside the loop.** If you need `state.config.gridW` 1,000 times, hoist it to a local.
- **Branch prediction matters.** Consistent branches (the same direction, every tick) are fast; data-dependent branches are slower. When you have a choice, prefer consistent branches.

This is the only code in GRID where micro-optimization is justified. Everywhere else, clarity wins.

### State hashing (`src/sim/serialize.ts`)

State hashing runs every 30 ticks (every 3 seconds), so it's not as hot as `simulateTick`, but it processes the entire state and is quadratic-ish in the cell count if done naively. The budget: **under 10 ms for a typical neighborhood state**.

Discipline:

- **Stream the hash, don't build a string.** Feed bytes directly into the hash function. Don't `JSON.stringify` and then hash the string.
- **Sort once.** If you need sorted iteration twice, sort once and reuse the result.

### The renderer's diff loop (`src/render/grid.ts`)

The renderer compares the current state to the previously-rendered state and emits ANSI escapes only for cells that changed. This dirty-rect approach is what keeps GRID's network of escape sequences manageable. The budget: **under 5 ms per frame**.

Discipline:

- **Compare cells by value, not by identity.** Identity comparisons fail when the simulation produces a new state object every tick.
- **Batch ANSI sequences.** Don't write one escape per cell. Build a buffer per row and write the row at once.
- **Use the synchronized output mode** (`\e[?2026h` ... `\e[?2026l`) to prevent tearing on terminals that support it. Detect support at startup.

### The lockstep input collection loop (`src/net/lockstep.ts`)

This loop runs once per tick and waits for inputs from all peers. The budget is the same as the tick budget itself, with most of it spent waiting on the network. Discipline:

- **Don't poll.** Wait on events; don't busy-loop.
- **Use a single timer, not one per peer.** A single deadline check is cheaper than N parallel timers.

## What "fast enough" looks like

A GRID session that meets all the budgets feels like this:

- Type `npx grid`. Within 2 seconds, the intro animation begins.
- The intro completes in 1.5 seconds. Total to playable: ~3.5 seconds (warm `npx` cache) or ~5 seconds (cold cache).
- The grid renders smoothly at 10fps. No visible stutter, no flicker, no tearing.
- Pressing an arrow key produces a turn within ~150 ms (one tick of latency, perceptually instant).
- After 5 minutes of play, memory is stable around 30–40 MB. No upward drift.
- Other peers in the mesh see each other's cycles in real time. The slowest visible delay is ~150 ms, which feels like a sluggish-but-playable connection.
- CPU usage is under 10% of one core during active play, under 5% during spectating.

If your changes preserve all of these, performance is fine. If they break any of them, find out why.

## Profiling

When you need to profile:

```bash
node --prof src/cli/main.js          # produces an isolate-*.log
node --prof-process isolate-*.log    # turn it into readable text
```

Or, for a specific scenario:

```bash
node --inspect src/cli/main.js       # attach Chrome DevTools or VS Code
```

For the simulation specifically:

```bash
node --inspect-brk scripts/perf-tick.ts
```

Profile in **realistic conditions**, not synthetic benchmarks. A loop that processes 1,000,000 fake ticks tells you nothing about the real game; a 5-minute recorded session of actual play tells you everything.

## Caches and memoization

Caching is sometimes necessary. It is also a frequent source of bugs and complexity. The discipline:

- **Don't add a cache without a measurement.** Show that the uncached version is too slow.
- **Don't cache pure functions for free.** Pure functions are already fast; caching them adds memory and bookkeeping for no clear gain.
- **Cache invalidation is your responsibility.** A cache that is never invalidated is a memory leak. A cache that's invalidated incorrectly is a correctness bug. Decide upfront when entries are evicted.
- **Bounded caches only.** Use an LRU or a fixed-size table. Unbounded caches are forbidden in v0.1.

## Memory discipline

GRID should run on modest hardware. Specific rules:

- **No unbounded queues.** Every queue has a max size. Overflow is handled (drop, evict, error) explicitly.
- **No memory leaks across days.** A GRID client that runs for 24 hours through several daily resets must not grow its memory monotonically. Memory at hour 24 is roughly memory at hour 1.
- **Buffers for hot paths are pre-allocated and reused.** The renderer's frame buffer, the network message scratch space, the state hash buffer — all of these are allocated once and reused forever.
- **Big strings are avoided.** A 1 MB string is not free; it allocates, it gets GC'd, it fragments the heap. Stream when possible.

## When you need to break a rule

If a measured optimization requires breaking a rule from `code-style.md` or `architecture-principles.md`:

- **Document the reason** in a comment, with the measurement that justifies it.
- **Isolate the deviation** to the smallest possible scope. One function, one file.
- **Keep the slow-and-clean version available** as a comment or in git history. If the optimization turns out to be wrong, reverting should be easy.
- **Re-measure after a few months.** Optimizations rot. Hardware changes. Sometimes the slow version becomes the fast version on newer Node releases.

The optimization is the exception, not the rule. The default in GRID is **clear, simple, correct**. Speed is added only where measurement says it's needed.
