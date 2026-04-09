# Persistence

GRID is a persistent place, not a sequence of disposable matches. This document describes how the world's state survives across rounds, across player sessions, across the day, and across days. There are three layers:

1. **Within the day**: the grid accumulates trails and structures across rounds, held collectively by the peers in the day's mesh and persisted to Nostr relays as a backup.
2. **At midnight UTC**: the grid resets, and the day's recap is computed and written to the public archive.
3. **Forever**: the public archive accumulates a permanent history of every day's grid.

## The world model

GRID has **one global grid per day**. Every player on Earth who types `npx grid` on the same day enters the same world. The world's dimensions are computed deterministically from yesterday's peak player count, so the grid scales with its population:

```
width  = clamp(40, floor(20 * sqrt(yesterdayPeak)), 500)
height = floor(width / 2)
```

| Yesterday's peak | World size |
|---|---|
| 0 (day one / no data) | 120 x 60 (default) |
| 1-4 | 40 x 20 |
| 10 | 63 x 31 |
| 25 | 100 x 50 |
| 100 | 200 x 100 |
| 500 | 447 x 223 |

The world config for each day is published as a Nostr event at midnight UTC by every peer online at the reset. New peers joining the next day fetch it. If no config is found (day one, or all relays down), the default size is used.

The world is larger than any player's terminal. Each player sees a **viewport** centered on their cycle — a window into the world. The world scrolls around the player as they move. The world boundary is a physical wall rendered in cyan box-drawing characters, visible only when the player is near it. Beyond the world boundary is void (black). See [`../design/identity-and-aesthetic.md`](../design/identity-and-aesthetic.md) for the rendering details.

## Time-anchored simulation

The simulation's tick number is anchored to real time:

```
dayStartMs = midnight UTC today, in milliseconds
tickAtTime(t) = floor((t - dayStartMs) / TICK_DURATION_MS)
```

At 10 ticks per second, a full day is 864,000 ticks (well within the u32 tick limit of 4,294,967,295). Every peer computes the same tick number from the same wall clock. This anchoring has a critical consequence: **the grid decays whether or not anyone is online.** A trail cell deposited at 2:00 PM has a known age at 3:00 PM regardless of who was connected in between.

The simulation core (`src/sim/`) does not know about this anchoring — it remains pure and tick-based. The networking layer (`src/net/`) enforces the alignment by pacing the lockstep toward the real-time target tick.

## Layer 1: within the day

### The day's grid is held by the peers, collectively

There is no server holding the day's state. The state is whatever the active peers in today's mesh believe it is, kept consistent by the lockstep simulation (see [`determinism.md`](determinism.md)).

When all peers in a neighborhood are present:

- Every peer has a full local copy of the neighborhood's grid state.
- Every peer is running the same deterministic simulation, so all copies stay identical tick-by-tick.
- New events (kills, spawns, decays) are produced by the simulation, not communicated separately.

When a peer leaves:

- The remaining peers continue. The state is undisturbed.

When a peer joins:

- The joiner requests the current state from the most-senior peer (longest-connected).
- The senior peer responds with a serialized snapshot.
- The joiner installs the snapshot and joins the lockstep from the next tick.

When **all peers leave**:

- The last peer publishes a cell snapshot to Nostr and writes a local backup to `~/.grid/`. See "Nostr persistence" below.
- The next peer to arrive reconstructs the world from Nostr (or local backup), filtering out cells that have decayed since the snapshot was written. The world continues where it left off, minus the decay that occurred while empty.
- If neither Nostr nor local backup is available, the peer starts with an empty grid at the current real-time tick. This is acceptable — not ideal, but no worse than day one.

### Cross-round persistence

A "round" in GRID is the time between when a particular cycle spawns and when it derezzes. Rounds are *not* simulation boundaries. The simulation is continuous within the day; rounds are just per-cycle lifetimes embedded in it.

Concretely: when a cycle dies, only that cycle is reset. The grid keeps everything else: other cycles still alive, all decaying trails, all structures. The dead cycle's trail itself remains and decays normally. The next respawn just adds a fresh cycle to the existing world.

This is what makes the grid feel like a place rather than a series of matches. The trails you fight on were laid by people who left an hour ago.

### Self-describing cells

Cells store their visual identity (colorSeed) directly, rather than referencing the player map. This means:

- Orphaned trails (from players who disconnected) keep their identity color.
- Persisted cells are self-rendering — no player map lookup needed.
- Cross-room cells (v0.2) are self-describing — they don't reference a foreign player map.

### Decay

Persistent state is balanced by decay. Without decay, the day's grid would accumulate trails for hours and become unplayable choke. With decay calibrated correctly, the grid breathes: cells appear, age, and fade, and the visible state at any moment is a snapshot of the last ~minute or two of activity.

Decay rules in v0.1:

- Trail cells have a half-life of approximately 60 seconds.
- Decay is implemented as a hard ceiling: a cell is removed when its age reaches `2 * halfLifeTicks` (120 seconds at default settings). There is no probabilistic decay — the ceiling is pure integer arithmetic, spends zero PRNG entropy, and is trivially deterministic.
- Older trails fade through dimmer Unicode characters (`▓ ▒ ░`) and dimmer colors before disappearing.
- Because ticks are time-anchored, decay happens in real time even when no peers are online. A returning peer computes `age = tickAtTime(now) - cell.createdAtTick` and discards expired cells.

The half-life is a tuning parameter, not a constant. It will be adjusted based on real play. See [`../design/goals.md`](../design/goals.md) for the design rationale.

## Nostr persistence

Nostr relays serve as the **backup persistence layer** — the grid's memory between peer sessions. During active play, the lockstep is authoritative. When all peers leave, Nostr holds the state until someone returns.

### Cell snapshots

Periodically (every 60 seconds during active play, and always on graceful shutdown), the room publishes a compressed cell snapshot to Nostr:

```
Kind: 22769 (grid:cells)
Tags: [["d", "grid:2026-04-09:cells"], ["tick", "540000"]]
Content: <compressed binary cell array>
```

The cell array is a compact binary format (see "Compact cell encoding" below), compressed with the best available built-in algorithm (gzip, brotli, or raw deflate — benchmarked during implementation).

### Compact cell encoding

Each cell is encoded as a fixed-size binary record:

```
Per cell: 14 bytes
  x:              u16   (2 bytes)  — world coordinate
  y:              u16   (2 bytes)
  createdAtTick:  u32   (4 bytes)  — time-anchored
  colorSeed:      u32   (4 bytes)  — self-describing visual identity
  type:           u8    (1 byte)   — trail/wall/structure (future-proof)
  ownerHash:      u8    (1 byte)   — first byte of FNV-1a(ownerId), for attribution
```

5,000 cells x 14 bytes = 70 KB uncompressed. With compression, typically 15-25 KB. Well within Nostr event size limits.

### Local backup

On shutdown, the client also writes the cell snapshot to `~/.grid/state-{day}.bin`. On cold start, the client checks local file AND Nostr, using whichever is more recent. The local file handles "same machine reconnects" without Nostr.

### Cold-start flow

When a peer joins and finds no active peers:

1. Fetch the latest `grid:cells` snapshot from Nostr for today's day key.
2. If not found, check `~/.grid/state-{day}.bin`.
3. Deserialize the cell array.
4. Compute `currentTick = tickAtTime(Date.now())`.
5. Filter out cells where `currentTick - cell.createdAtTick >= 2 * halfLifeTicks`.
6. Build initial `GridState` with surviving cells and `tick = currentTick`.
7. Start the lockstep at `currentTick`, unpause after the seed timeout.

The returning player enters a world shaped by everyone who played before them, with realistic decay applied to the interval when no one was online.

### World config events

```
Kind: 22768 (grid:world-config)
Tags: [["d", "grid:2026-04-09"], ["w", "120"], ["h", "60"], ["peak", "25"]]
```

Published at midnight UTC by every peer online at the reset. Contains the computed world dimensions for the next day. Deterministic — all publishers produce identical data. On cold start, the first peer fetches this to know the world size.

## Cryptographic integrity: the hash chain

Cell snapshots on Nostr are signed by their publisher (Nostr events have built-in Schnorr signatures), but a single signer can publish fake data. The hash chain adds **multi-peer consensus** — tamper-evidence for the grid's entire history.

### How it works

The client already computes `hashState(state)` every 30 ticks for peer-to-peer anti-cheat. The hash chain extends this by publishing a subset of these hashes to Nostr with chaining:

```
chainHash(tick) = SHA256(prevChainHash + stateHash(tick) + tick)
```

Each link is published as a Nostr event:

```
Kind: 22770 (grid:chain)
Tags: [
  ["d", "grid:2026-04-09"],
  ["tick", "600"],
  ["sh", "a3f8c92b7e1d4f06"],     — stateHash (8 bytes hex)
  ["ch", "b4e9...64 hex chars"],   — chainHash (32 bytes)
  ["prev", "a1c3...64 hex chars"], — previous chainHash
  ["peers", "3"]                   — peer count (consensus weight)
]
```

Published every 300 ticks (30 seconds) per room. Multiple independent peers publishing the same `chainHash` for the same tick constitutes consensus — the state is authentic.

### What it proves

- Any tampering with ANY prior state breaks the chain from that point forward.
- A cell snapshot whose tick is attested by multiple independent signers with matching chain hashes is trustworthy.
- A solo player's chain has lower confidence (single signer) but is still useful — it's the best data available.

### Cost

~250 bytes per event, one every 30 seconds per room. With 8 rooms: ~16 events/minute. Negligible relay load.

### Verification on cold start

1. Fetch the latest `grid:chain` events for today.
2. Group by tick. Check: was the `chainHash` published by multiple independent pubkeys?
3. Fetch the cell snapshot for that tick.
4. Verify: state hash matches the reconstructed cells.
5. Multi-signer consensus = trusted. Single signer = best-effort. No chain data = trust the snapshot anyway (graceful degradation).

### Identity keypair

The identity cache (`~/.grid/identity.json`) is extended with a Nostr-compatible keypair:

```json
{
  "id": "corne@thinkpad",
  "colorSeed": 12345,
  "nostrPubkey": "02ab3f...",
  "nostrPrivkey": "..."
}
```

Generated once alongside the identity. Used to sign all Nostr events published by this client. The pubkey is the player's cryptographic identity — persistent across sessions, independently verifiable.

### What cryptocurrency teaches us (and what we skip)

GRID borrows **signatures** (who created this?) and **hash chains** (in what order?) from cryptocurrency. It does NOT need proof-of-work, mining, tokens, or consensus protocols. Cells are add-only facts (a Grow-Only Set with implicit expiry) — there is nothing to "double-spend." The hash chain is lightweight, serverless, and costs almost nothing because we already compute state hashes.

## The CRDT nature of cells

Cells are naturally a **Grow-Only Set (G-Set) with TTL** — the simplest conflict-free replicated data type:

- **Add:** deposit a cell at `(x, y)` with a `createdAtTick`. Idempotent — same position + tick = same cell.
- **Merge:** union of two sets. If two cells claim the same position, latest `createdAtTick` wins.
- **Remove:** implicit — cells older than `2 * halfLifeTicks` are expired.

This means cross-room gossip (v0.2) is trivially conflict-free. Two rooms that independently add cells can merge by union. No coordination protocol needed. The cell model is CRDT-compatible today without any changes.

## Scaling state with population

The grid's *active region* expands and contracts with population:

- A neighborhood with 6 active programs maintains a grid region of approximately 80x40 cells.
- A neighborhood with 2 active programs maintains a grid region of approximately 40x20 cells.
- The region is never larger than the terminal can render; if the player's terminal is smaller than the region, they see a viewport that follows their cycle.

The active region's size is part of the simulation state, and resizing happens deterministically when the peer count changes.

## Layer 2: midnight UTC reset

At 00:00 UTC every day, every active GRID client performs the **daily ritual**:

1. **Snapshot.** Each neighborhood serializes its current grid state and computes the day's contributions: kills per player, cells per player, longest runs, cascade chains, etc.
2. **Crown computation.** Each neighborhood computes its local view of the five crowns from the day's contribution data.
3. **Recap publication.** The neighborhood publishes its local recap to a Nostr topic (`grid:recap:YYYY-MM-DD`). Other neighborhoods do the same.
4. **Aggregation.** A short window (~30 seconds) is allowed for all neighborhoods' recaps to propagate. A simple deterministic merge combines them into a global recap.
5. **Archive write.** The merged recap and a compressed input log of the day's notable moments are written to the **public archive** (see Layer 3).
6. **World config publication.** The computed world dimensions for the new day are published to Nostr.
7. **Grid reset.** Every peer's simulation is reset to a fresh state seeded by the new day's date. The cycle continues.

### What gets aggregated

- **The Last Standing:** the longest-lived program across all neighborhoods. Each neighborhood reports its local longest, the global is the max.
- **The Reaper:** total kill counts across the day. Each neighborhood reports its local kills per player, the global is the sum.
- **The Architect:** total cell-tick area across the day. Each neighborhood reports its local integral, the global is the sum.
- **The Catalyst:** the largest cascade chain across the day. Each neighborhood reports its biggest, the global is the max. (Cross-neighborhood cascades are out of scope for v0.1.)
- **The Mayfly:** the highest pilot session score across the day. Each neighborhood reports its best, the global is the max.

### Handling neighborhood-disconnect during the reset

If a neighborhood is offline at midnight (all its peers have left), its local state is *lost* unless it had time to gossip to a sibling. v0.2 will mitigate this with periodic checkpoints; v0.1 accepts the loss because it only happens during low-population windows when there is little state to lose.

If a neighborhood comes online *during* the reset window, it joins the new day's grid directly and does not contribute to yesterday's recap.

## Layer 3: the public archive

The archive is the permanent memory of GRID. After a year, it contains 365 days of grids, ~1800 crown-holdings, and thousands of notable moments. Players reference the archive in conversation. The archive is what makes GRID unkillable: even if every player stopped playing for a year and the grid went silent, the history would still exist, browsable by anyone.

### Where the archive lives

The archive is a **public git repository** mirrored to multiple locations. The default mirror is on GitHub (`github.com/grid-archive/days`); secondary mirrors live on GitLab, Codeberg, and as IPFS pins.

Each day's entry in the repository is a single directory:

```
2026-04-07/
  recap.json        # crown holders, day stats
  highlights.json   # notable moments (top kills, longest runs, biggest cascades)
  replay.bin        # compressed input log (~10–100KB)
  README.md         # human-readable summary, auto-generated
```

### Who writes the archive

In v0.1 and v0.2, the archive is written by **any peer that volunteers**. At midnight, the merged recap is published to the Nostr `grid:recap:YYYY-MM-DD` topic. Any peer that has commit access to the archive repository (this is initially the GRID authors, expanding over time to trusted community members) commits the recap and pushes it.

The peer-to-peer protocol does not depend on the archive being written. If nobody volunteers, the day's recap exists only in the Nostr topic until someone copies it. The Nostr topic is itself a distributed record — it lives on multiple Nostr relays — so the data is never *lost*, only un-archived.

In v0.3+, the archive may transition to **fully decentralized writes** via a CRDT or a signed-event protocol where any peer can submit and verify recaps without central commit access. v0.1 is centralized-write because it's simpler and the trust assumptions are acceptable for the launch period.

### Browsing the archive

The GRID client supports an offline command:

```
$ npx grid history
```

This clones (or updates) the archive repo into `~/.grid/archive/` and presents a TUI for browsing days, crowns, players, and moments. Replays can be played back in the terminal with full simulation fidelity:

```
$ npx grid history --day 2026-04-07 --replay
```

The replay system is the same simulation core as live play, just fed inputs from the recorded log instead of the network.

### What the archive enables

- **Cultural reference.** Players talk about famous days. "Did you see day 47, when `marie@thinkpad` held the Last Standing for 18 hours?" This sentence is the entire pitch for permanence.
- **Daemon training.** A daemon author can replay yesterday's grid and test their bot against historical situations.
- **Player history.** A player can search the archive for their own past appearances and see what they did months ago.
- **Anti-fragility.** Even if all current players disappear, the archive remains. The next person to type `npx grid` can browse a year of history before they ever play.

## Spatial rooms and cross-room persistence (v0.2)

In v0.1, all players share a single room (up to 6 peers). In v0.2, the world is partitioned into spatial sectors, each sector being a room. This section describes the design that v0.1 anticipates but does not build.

### Fixed-sector partitioning

The world is divided into rectangular sectors. Each sector is a room with its own lockstep. Players in the same sector are in the same room.

```
World: 200x100
Sector size: 60x40 (tunable)
Grid: 4x3 = 12 sectors
Each sector: room key "grid:2026-04-09:s2-1"
```

### Room migration

When a player's cycle crosses a sector boundary:

1. Client sends `BYE` to the old room.
2. Connects to the new room via Nostr signaling.
3. Sends `HELLO`, receives `STATE_RESPONSE` for the new sector.
4. Brief transition (~1-2s).

### Cross-room cell gossip

Each room publishes its cell snapshot to Nostr every 60 seconds. Adjacent rooms subscribe to their neighbors' snapshots. Cross-room cells are visible with ~60 second propagation delay. Direct WebRTC gossip between adjacent rooms can reduce this to <1 second.

The CRDT nature of cells makes cross-room merging trivially conflict-free: union of sets, latest timestamp wins on position conflicts.

### Why v0.1 doesn't build this

With <50 expected players and the world sized to match, a single room covers the entire play area. The viewport camera gives the "big world" feeling. Spatial rooms become necessary at ~20+ simultaneous players, which is a v0.2 scale.

The v0.1 architecture anticipates spatial rooms by:
- Using world coordinates (not room-local) for all cell keys
- Making cells self-describing (colorSeed stored on cell)
- Keeping the simulation independent of room boundaries
- Structuring `NetClient` so it can be stopped/started with different room keys

## Implementation notes for v0.1

- **Persistence within the day:** Nostr cell snapshots + local file backup. The persist module (`src/persist/`) handles both.
- **Self-describing cells:** `Cell` type includes `colorSeed` alongside `ownerId`. FORMAT_VERSION bumped to 2.
- **Time-anchored ticks:** `tickAtTime()` utility in `src/net/`. Lockstep paces toward the real-time target.
- **Compression:** Cell snapshots are compressed using the best available Node.js built-in algorithm (gzip, brotli, or raw deflate — benchmarked and selected during implementation).
- **Hash chain:** Computed and published every 300 ticks. Verification on cold start is best-effort (graceful degradation if chain data is missing).
- **Identity keypair:** Nostr-compatible Schnorr keypair generated with the identity and stored in `~/.grid/identity.json`.
- **Joiner sync:** `STATE_REQUEST` / `STATE_RESPONSE` remains the primary sync mechanism during active play. Nostr is only for bridging peer-free gaps.
- **Midnight reset:** implement the reset trigger and the snapshot serialization in v0.1. Recap aggregation and Nostr publication can be stubbed in v0.1 (logged locally) and made real in v0.2.
- **Archive:** **do not build the archive in v0.1.** The protocol must be designed so that future archive writes can replay v0.1 sessions, but the archive itself is a v0.2 feature. v0.1 just ensures no data is structurally unrecoverable.
- **Local cache:** `~/.grid/` contains the identity cache (with keypair), cell snapshots for today, optional archive clone, and a small log of the player's own session history. Nothing else.
