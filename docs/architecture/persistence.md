# Persistence

GRID is a persistent place, not a sequence of disposable matches. This document describes how the world's state survives across rounds, across player sessions, across the day, and across days. There are three layers:

1. **Within the day**: the grid accumulates trails and structures across rounds, held collectively by the peers in the day's mesh.
2. **At midnight UTC**: the grid resets, and the day's recap is computed and written to the public archive.
3. **Forever**: the public archive accumulates a permanent history of every day's grid.

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

### Cross-round persistence

A "round" in GRID is the time between when a particular cycle spawns and when it derezzes. Rounds are *not* simulation boundaries. The simulation is continuous within the day; rounds are just per-cycle lifetimes embedded in it.

Concretely: when a cycle dies, only that cycle is reset. The grid keeps everything else: other cycles still alive, all decaying trails, all structures. The dead cycle's trail itself remains and decays normally. The next respawn just adds a fresh cycle to the existing world.

This is what makes the grid feel like a place rather than a series of matches. The trails you fight on were laid by people who left an hour ago.

### Decay

Persistent state is balanced by decay. Without decay, the day's grid would accumulate trails for hours and become unplayable choke. With decay calibrated correctly, the grid breathes: cells appear, age, and fade, and the visible state at any moment is a snapshot of the last ~minute or two of activity.

Decay rules in v0.1:

- Trail cells have a half-life of approximately 60 seconds.
- Decay is implemented as: each tick, every cell has a small chance of advancing one step toward emptiness (`alive` → `fading_1` → `fading_2` → `fading_3` → empty). The chance is computed deterministically from the cell's age and a fixed-point parameter.
- Older trails fade through dimmer Unicode characters and dimmer colors before disappearing.
- Decay is **deterministic**. Two peers running the same simulation will see the same cell decay at the same tick.

The half-life is a tuning parameter, not a constant. It will be adjusted based on real play. See [`../design/goals.md`](../design/goals.md) for the design rationale.

### Scaling state with population

The grid's *active region* expands and contracts with population:

- A neighborhood with 6 active programs maintains a grid region of approximately 80×40 cells.
- A neighborhood with 2 active programs maintains a grid region of approximately 40×20 cells.
- The region is never larger than the terminal can render; if the player's terminal is smaller than the region, they see a viewport that follows their cycle.

The active region's size is part of the simulation state, and resizing happens deterministically when the peer count changes.

## Layer 2: midnight UTC reset

At 00:00 UTC every day, every active GRID client performs the **daily ritual**:

1. **Snapshot.** Each neighborhood serializes its current grid state and computes the day's contributions: kills per player, cells per player, longest runs, cascade chains, etc.
2. **Crown computation.** Each neighborhood computes its local view of the five crowns from the day's contribution data.
3. **Recap publication.** The neighborhood publishes its local recap to a Nostr topic (`grid:recap:YYYY-MM-DD`). Other neighborhoods do the same.
4. **Aggregation.** A short window (~30 seconds) is allowed for all neighborhoods' recaps to propagate. A simple deterministic merge combines them into a global recap.
5. **Archive write.** The merged recap and a compressed input log of the day's notable moments are written to the **public archive** (see Layer 3).
6. **Grid reset.** Every peer's simulation is reset to a fresh state seeded by the new day's date. The cycle continues.

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

## Implementation notes for v0.1

- **Persistence within the day:** the simulation state already serves this. No additional storage needed beyond what each peer holds in memory.
- **Joiner sync:** implement `STATE_REQUEST` / `STATE_RESPONSE` messages in the wire protocol from day one (see [`../protocol/wire-protocol.md`](../protocol/wire-protocol.md)).
- **Decay:** implement deterministic age-based decay in the simulation core. Half-life parameter is a config constant for v0.1, hardcoded to 60 seconds.
- **Midnight reset:** implement the reset trigger and the snapshot serialization in v0.1. Recap aggregation and Nostr publication can be stubbed in v0.1 (logged locally) and made real in v0.2.
- **Archive:** **do not build the archive in v0.1.** The protocol must be designed so that future archive writes can replay v0.1 sessions, but the archive itself is a v0.2 feature. v0.1 just ensures no data is structurally unrecoverable.
- **Local cache:** `~/.grid/` contains the identity cache, optional archive clone, and a small log of the player's own session history. Nothing else.
