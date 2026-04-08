# Determinism rules

**This is the most safety-critical document in the project.** Read it before any change inside `src/sim/`.

GRID's lockstep netcode requires that every peer's simulation produces **bit-identical** state given identical inputs. Every peer. Every tick. On every machine. Forever. If this property breaks, lockstep desyncs cascade through the network within seconds and the game is unplayable.

The rules in this document are the *operational constraints* that protect determinism. They are non-negotiable inside `src/sim/`. Outside `src/sim/`, they don't apply at all (the rest of the codebase is allowed to be impure, allocate freely, use the system clock, etc.).

## The hard rules

These are the rules that, if violated, **will** cause desyncs eventually. Most of them have automated enforcement (lint rules, CI tests, type-system tricks). All of them are also enforced by code review.

### Rule 1: No floating-point arithmetic

**Never** use `number` for any value that is part of the simulation state, computed from simulation state, or used to make a simulation decision.

Floating-point is non-deterministic across CPU architectures, compiler versions, and operating systems. Even when it appears to be "the same," it isn't — denormals, rounding modes, and FMA fusion vary across platforms.

```ts
// ❌ WRONG
const speed = position * 0.5;
const probability = Math.random() < 0.1;
const distance = Math.sqrt(dx * dx + dy * dy);

// ✅ RIGHT
const speed = position >> 1;        // bit shift, integer halving
const probability = (rng.next() % 100) < 10;  // integer ratio
const distance = isqrt(dx * dx + dy * dy);    // integer square root helper
```

If you need fractional values, use **fixed-point integers**: store the value scaled by some power of two (e.g., 1/256), do all math in integer space, and unscale only at the very edge when handing the value to the renderer (which is outside `src/sim/` and may use floats freely).

If you need probability, express it as `numerator / denominator` with both as integers.

If you need transcendental functions (sin, cos, sqrt), use integer approximations or precomputed tables. The simulation does not need real precision; it needs *identical* precision across all peers.

### Rule 2: No platform RNG

**Never** call `Math.random()`. Never call `crypto.randomBytes()`. Never call any function whose return value depends on the host's entropy source.

Use the **simulation's PRNG**, which lives in the simulation state and is advanced by every random call:

```ts
// src/sim/rng.ts
export type Rng = { state: bigint };
export function nextU32(rng: Rng): number { /* PCG32 step */ }
export function nextRange(rng: Rng, max: number): number { return nextU32(rng) % max; }
```

The PRNG is **part of the state**. Every random call advances the state. The state is serialized as part of the grid state and is included in the state hash. When a joiner syncs to a neighborhood, they receive the current PRNG state along with everything else.

The PRNG algorithm is **PCG32**. Implement it with explicit step semantics — do not use a third-party PRNG library, because the simulation has to be reproducible across language ports (the eventual `uvx` build) and we need to control the algorithm bit-for-bit. PCG32 is small enough to vendor in 30 lines.

Seed it once at the start of the day with `splitmix64(hash("grid:YYYY-MM-DD:" + neighborhood_id))`. The seed is reproducible from the day's date, so any peer joining the day can re-derive it.

### Rule 3: No platform clocks

**Never** call `Date.now()`, `performance.now()`, `process.hrtime()`, or any other function that returns wall-clock time, inside `src/sim/`.

The simulation has its own clock: **the tick number**. It is a `number` (integer-valued, but explicitly checked at compile time to never exceed 2^53 — see Rule 7). The tick number is part of the state and is advanced exactly once per `simulateTick` call.

```ts
// ❌ WRONG
const cellAge = Date.now() - cellCreatedAt;

// ✅ RIGHT
const cellAge = state.tick - cell.createdAtTick;
```

The networking layer uses wall-clock time to schedule ticks at 10/sec real-time. That code lives in `src/net/`, not `src/sim/`. The simulation core only knows "this is tick N."

### Rule 4: Sorted iteration, always

**Whenever** simulation code iterates a collection — `Map`, `Set`, plain object, `Array.from(map.entries())`, `Object.keys()` — the iteration must be in a **deterministic sorted order** keyed by something stable.

JavaScript's Map and Set iteration order is *mostly* insertion-order, but not always, and not for floating-point keys. Object iteration order has subtle rules around integer-like keys. Worse: even when iteration order is consistent within one engine, it may differ across engines, and the future Python port will not match either way.

```ts
// ❌ WRONG
for (const [id, player] of state.players) { ... }

// ✅ RIGHT
const sortedIds = Array.from(state.players.keys()).sort();
for (const id of sortedIds) {
  const player = state.players.get(id)!;
  ...
}
```

The standard helper for this lives in `src/sim/iter.ts`:

```ts
export function sortedEntries<V>(m: Map<string, V>): Array<[string, V]> {
  return Array.from(m.entries()).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
}
```

Use `sortedEntries`, `sortedKeys`, and `sortedValues` consistently. Direct `for...of` on a Map inside `src/sim/` is a code smell and the lint rule should flag it.

### Rule 5: No environment leakage

The simulation cannot read environment variables, files, command-line arguments, network state, or any other external state at runtime. Every input it consumes must come from its explicit parameters.

```ts
// ❌ WRONG
function simulateTick(state, inputs) {
  if (process.env.DEBUG) console.log(...);  // forbidden — env access
  return ...;
}

// ✅ RIGHT
function simulateTick(state, inputs) {
  return ...;  // just the math, no environment
}
```

Configuration that the simulation needs (decay rate, grid size, tick rate) is part of the **state's `config` field**, set at simulation initialization, gossiped to joiners along with the rest of the state, and never read from anywhere else.

### Rule 6: Pure functions only

The simulation is structured around one core function:

```ts
function simulateTick(state: GridState, inputs: Inputs): GridState
```

This function is **pure**: same inputs always produce the same output, no side effects, no mutation of `state` or `inputs` that the caller still holds a reference to.

The implementation may internally mutate copies for performance — lockstep simulations are allowed to do this and the state is large enough that immutable copying every tick would be slow. The discipline:

- The function takes `state` and `inputs`.
- It produces a `nextState` that is a fresh object (or a deep copy that has been mutated in place — same result from the caller's perspective).
- It never modifies the passed-in `state` in a way the caller can observe.
- It never modifies any global state.

The boundary between "internal mutation for speed" and "external purity" is **the function signature**. Inside the function, anything goes (within the other rules). Outside the function, the contract is pure.

### Rule 7: Bounded integers

JavaScript's `number` is a 64-bit IEEE float and breaks at 2^53. Python's `int` is arbitrary-precision. To make the simulation portable across language ports, **all integer values in the simulation are bounded to 32 bits**:

- Positions: 16-bit signed (`-32768..32767`). The grid is never larger than this.
- Tick numbers: 32-bit unsigned (`0..2^32-1`). At 10 ticks/second, this is ~13 years before wraparound — fine for the daily-reset model.
- Cell ages: 32-bit unsigned.
- RNG state: 64-bit unsigned (`bigint` in JS).

When doing arithmetic on these values, **intermediate results must also fit in the bound**. `(x * y)` where both are 16-bit may produce a 32-bit result; that's fine. `(x * y * z)` where all three are 16-bit may overflow 32-bit; use `bigint` for the intermediate or restructure the computation.

This is annoying. It is also the only way the eventual Python port produces bit-identical results to the Node port without complicated runtime checks.

### Rule 8: Canonical serialization

When serializing simulation state for hashing or for transmission to a joining peer, the serialization must be **canonical** — the same state always produces the same bytes, regardless of how the state was constructed.

The canonical serialization rules:

- All keys are sorted.
- All collections are iterated in sorted order.
- Integers are encoded as fixed-width little-endian byte sequences (not as JSON numbers).
- Strings are encoded as length-prefixed UTF-8.
- Booleans are encoded as a single byte (`0x00` or `0x01`).
- The PRNG state is included.
- The tick number is included.
- No floating point appears anywhere.

The canonical serialization implementation lives in `src/sim/serialize.ts`. State hashing uses SHA-256 of the canonical bytes, truncated to 64 bits for transmission. See [`../architecture/determinism.md`](../architecture/determinism.md) for the full state hashing protocol.

## How to verify you didn't break anything

Three layers of verification protect the determinism property. Use all three.

### Layer 1: the unit tests (every change)

Every function in `src/sim/` has unit tests. The tests are pure, fast, and run on every commit. They catch obvious bugs.

### Layer 2: the property-based tests (every PR)

Property-based tests generate random sequences of inputs and verify two properties:

1. **Idempotency.** Running the same sequence twice produces the same final state.
2. **Replay equivalence.** Running the sequence forward, then re-running from the initial state with the recorded inputs, produces the same final state.

These tests are slower (~10 seconds for a deep run) but they catch a class of bugs unit tests miss: subtle non-determinism that only shows up under particular sequences. Run them locally before pushing.

### Layer 3: the cross-platform CI test (every push)

The CI runs the same simulation on **Linux and Windows in parallel**, computes a state hash at the end, and **fails the build if the hashes differ**. This is the smoke test that catches platform-dependent bugs.

If the cross-platform test fails, **stop and investigate immediately**. Never disable it. Never mark it as flaky. A failure here is the loudest possible alarm that determinism has been broken, and the fix is much cheaper now than it will be after a week of layered changes obscure the source.

The CI test runs in [`.github/workflows/determinism.yml`](../../.github/workflows/determinism.yml) (when the project is set up). Set this up in stage 1 of the build, before the simulation is complex enough to make debugging hard.

## What can go wrong

Real causes of determinism bugs in similar projects, each of which would be caught by the rules above if applied consistently:

- A `Math.random()` snuck into a "small helper" function that turned out to be called from inside `simulateTick`.
- A `Date.now()` used as a tiebreaker in collision resolution. Each peer had a different idea of "now."
- A `Map.values()` iteration that happened to work in V8 in 2024 but stopped working when V8 changed iteration internals.
- A floating-point distance computation between two integer positions, used to pick the closest opponent.
- A `for (const k in obj)` over an object whose keys included both string and integer-like keys, where the iteration order differed between V8 and SpiderMonkey.
- A `JSON.stringify` used for state hashing, where two equivalent objects produced different strings because of property insertion order.
- An `Array.sort()` with no comparator on an array of strings that contained Unicode characters above U+FFFF.

All of these are *easy to write* and *hard to debug*. The rules above prevent each one.

## When to bend the rules

You don't. The rules in this document are the only ones in the entire project that have no exceptions.

If a task seems to require violating one of them, the right answer is to redesign the task. The simulation boundary is not a guideline — it is the property the rest of the project depends on. Anything outside `src/sim/` may bend the rules freely; anything inside it may not.

If you find an apparent need to bend a rule, **stop and ask before proceeding**. There is almost always a different design that doesn't require it.
