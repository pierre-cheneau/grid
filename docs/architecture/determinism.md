# Determinism

The most important property of GRID's game logic is that **every peer's simulation produces bit-identical state given identical inputs**, every tick, on every machine, forever. This property is called *determinism*, and it is the foundation of GRID's lockstep netcode and its anti-cheat.

If determinism is wrong, nothing else works. If determinism is right, the rest of the architecture falls into place.

## Why determinism

Lockstep simulation means each peer simulates the entire game locally, exchanging only player inputs (not state). This is dramatically more efficient than sending state — inputs are tiny (a few bytes per tick per player) while state is large (the whole grid). It also has another, deeper property: if all peers run the same simulation deterministically, they all arrive at the same state without ever needing a server to tell them what the state is.

Consequences:

- **No authoritative server.** The grid is whatever the peers collectively believe. There is no other source of truth.
- **Anti-cheat by consensus.** If a peer's local state diverges from the rest, it is provably cheating (or buggy, or running modified code), and the others can evict it.
- **Replay for free.** A complete replay of any session is just the initial seed plus the input log. A 90-second match is a few hundred bytes. The entire daily archive is small.
- **Cross-platform fairness.** A Linux player and a Windows player with the same inputs see the same grid.

## What determinism requires

Determinism is not free. The simulation code has to be carefully written to avoid every source of non-determinism. The non-negotiable rules:

### 1. Integer math only

No floating point. Anywhere. Floating point is non-deterministic across CPU architectures, compiler versions, and operating systems. Even when it's "the same," it isn't.

- Positions are integers (grid cells, not sub-cell positions).
- Decay timers are integer tick counts, not seconds.
- Probabilities (for random events) are integer ratios, not floats.

### 2. Deterministic RNG with explicit seeds

Any randomness in the simulation comes from a **single seeded PRNG** that is part of the simulation state. Every random call advances the PRNG state in a documented way. The seed is derived from the day's date and the neighborhood ID.

- Use a small, well-understood PRNG: PCG, xoshiro, or splitmix64. Not `Math.random()`. Not the platform RNG.
- Seed it once at the start of the day with `hash("grid:YYYY-MM-DD:" + neighborhood_id)`.
- Persist the PRNG state in the simulation state. When a joiner syncs, they get the current PRNG state along with everything else.

### 3. Sorted iteration

JavaScript object iteration order is *mostly* insertion-order, but not always, and not across all engines. Map iteration order is reliable but only for the same insertion order across machines. **Whenever the simulation iterates a collection, it must iterate it in a sorted order**, sorted by a stable key (player ID, cell coordinates, tick number).

- Players are processed in sorted order by player ID.
- Cells are processed in sorted order by `(y, x)`.
- Inputs are processed in sorted order by `(tick, player_id)`.

### 4. No platform clocks in the simulation

The simulation has its own clock: the tick number. It has no awareness of wall-clock time. Functions like `Date.now()`, `performance.now()`, `process.hrtime()` are forbidden inside the simulation core.

The networking layer uses wall-clock time to schedule ticks (10/sec), but the simulation itself only knows "this is tick N." This separation must be enforced strictly.

### 5. No environment leakage

The simulation cannot read environment variables, files, or any other external state at runtime. Every input it consumes must come from the explicit inputs structure. If the simulation needs configuration (decay rate, grid size), that configuration is part of the initial state and is gossiped to joiners along with everything else.

### 6. Pure functions

The simulation is structured as a pure function:

```
nextState = simulateTick(currentState, inputsThisTick)
```

No side effects. No mutation of `currentState`. No global state. The same inputs always produce the same output. This is the cleanest way to enforce all the above rules: if the function is pure, non-determinism is structurally impossible.

(In practice, for performance, the implementation may mutate a copy in place. The *contract* is purity even if the implementation is more efficient.)

## State hashing

Every N ticks (default N=30, i.e., every 3 seconds), each peer computes a **state hash** of the current simulation state and broadcasts it to the neighborhood.

### How the hash is computed

The state is serialized in a canonical, deterministic way:

1. Start with an empty hash buffer.
2. Append the tick number as a fixed-width integer.
3. Append all players, sorted by player ID. For each player, append their position, direction, alive flag, color, score.
4. Append all cells, sorted by `(y, x)`. For each cell, append its type, owner, age.
5. Append the PRNG state.
6. Compute SHA-256 of the buffer. Truncate to 64 bits.

All peers run this identically. Identical state produces identical hashes.

### Cross-checking hashes

Each peer broadcasts its hash. Each peer receives hashes from other peers. They are compared:

- **All hashes match.** Normal case. Continue.
- **One peer's hash differs.** The minority peer is desynced (cheating, bug, or corrupted state). The other peers vote to evict it. The minority peer is dropped from the mesh and asked to re-sync.
- **Two distinct groups of hashes.** Network partition or coordinated cheating. The larger group continues; the smaller group is treated as a separate, isolated mesh.
- **Hashes arrive late or not at all.** The slow peer is given one tick of grace, then evicted by timeout.

### Why this is sufficient anti-cheat

GRID does not need cryptographic protection against determined attackers. There is nothing valuable to cheat for: no rank, no money, no items, no leaderboard climb. The hash check exists to:

- Catch *bugs* (the most common reason for desyncs).
- Catch *casual cheaters* who modify their client to make their cycle invincible.
- Make collusion expensive enough that nobody bothers.

A coordinated group of cheaters running a forked client could agree on fake hashes and outvote honest peers in a 6-peer mesh (4 cheaters vs 2 honest). This is acceptable because the cheaters are only ruining their own neighborhood for 90 seconds, and there is no cross-neighborhood reward to cheat for. The design makes cheating *pointless*, not impossible.

## Replay

Because the simulation is deterministic, a complete replay is:

```
{
  "seed": <initial PRNG seed>,
  "config": <decay rate, grid size, etc.>,
  "inputs": [
    [tick_0, player_id, input],
    [tick_1, player_id, input],
    ...
  ]
}
```

Anyone with this file can reconstruct the entire match by starting a fresh simulation from the seed and applying the inputs in order. The reconstructed state will be bit-identical to the original.

A 90-second 6-player match contains ~5400 inputs at 10 ticks/sec. Most ticks have no input (cycles only turn occasionally), so the actual log is on the order of a few hundred entries — a few kilobytes uncompressed, a few hundred bytes gzipped.

This is the foundation of:

- **The exit epitaph's "watch this run" hint.** Replays are tiny enough to share via URL or paste.
- **The daily archive.** The entire day's grid is stored as the seed plus the input log.
- **Daemon debugging.** A daemon author can replay yesterday's grid and test their bot against the same situations.
- **The Mayfly crown calculation.** Re-running the simulation with different scoring is cheap because the inputs are stored.

## Joiner sync

When a new player joins a neighborhood mid-session, they need to catch up to the current state. The simplest correct approach:

1. The joiner connects via WebRTC.
2. The joiner sends `STATE_REQUEST` to the most-senior peer in the room.
3. The senior peer responds with the *current full state* serialized canonically.
4. The joiner installs that state and begins simulating from the next tick.
5. From this moment on, the joiner is in lockstep with the rest of the mesh.

A more efficient approach is to send the seed + input log (the joiner replays from the beginning), but for v0.1 the full-state approach is simpler and the state is small enough that it's fine.

## Cross-language determinism (for the eventual `uvx` port)

When GRID is eventually ported to Python and shipped via `uvx`, the Python implementation must produce **bit-identical results** to the Node implementation. This is hard but tractable. The discipline:

- **Same PRNG algorithm.** Implement PCG (or whichever) with a reference test vector that both implementations must pass.
- **Same hash algorithm.** SHA-256 is standardized; both implementations get the same answer for free.
- **Same iteration order.** Both implementations sort collections explicitly before iterating.
- **Same integer arithmetic.** JavaScript's `Number` is float and breaks at 2^53; Python's `int` is arbitrary-precision. Both implementations should use bounded integers (32-bit for positions and timers) to avoid this.
- **Same canonical serialization.** Both implementations agree on byte-for-byte serialization for state hashing.
- **Cross-implementation test suite.** A set of `(initial_state, inputs) → expected_final_state` test cases that both implementations must reproduce identically. This is the contract that proves the port is correct.

This work is **explicitly out of scope for v0.1** but the v0.1 implementation should not paint itself into a corner. Every time the v0.1 implementation makes a determinism-relevant choice (PRNG, integer bounds, sort order), it should pick something the eventual Python port can reproduce.

## Implementation notes for v0.1

- Build the simulation as a pure function in a single TypeScript file with no I/O imports. Test it in isolation with a property-based test framework: random sequences of inputs should produce identical results when the simulation is run twice.
- Add a CI test that runs the simulation on two different machines (Linux + Windows in GitHub Actions) and checks that the final state hashes match. If they ever diverge, fail the build.
- The state-hash check across peers should be implemented as soon as the netcode exists. It is the smoke test that the simulation is actually deterministic in practice, not just in theory.
