# Architecture overview

This document is the technical big picture. For the *why* of each piece, see the design docs. For each piece's details, see the rest of this folder.

## Components, in plain language

GRID is a single client binary distributed via `npx grid`. There is no server. The client contains seven cooperating subsystems:

```
                           ┌─────────────────────┐
                           │  Identity (local)   │
                           │  ${USER}@${HOST}    │
                           │  cached color       │
                           └──────────┬──────────┘
                                      │
   ┌──────────────────────────────────┴──────────────────────────┐
   │                                                              │
   │   ┌──────────────┐    ┌──────────────┐   ┌──────────────┐  │
   │   │  Renderer    │    │ Determinism  │   │  Networking  │  │
   │   │  (TUI)       │←───┤ Game logic   │──→│  WebRTC mesh │  │
   │   │              │    │ (lockstep)   │   │  + Nostr sig │  │
   │   └──────────────┘    └──────┬───────┘   └──────┬───────┘  │
   │          ▲                   │                   │          │
   │          │                   │                   │          │
   │   ┌──────┴──────┐     ┌──────┴───────┐    ┌─────┴───────┐  │
   │   │ Input       │     │ Persistence  │    │  Daemon     │  │
   │   │ (keys/      │     │ (daily grid  │    │  subprocess │  │
   │   │  daemon)    │     │  + archive)  │    │  bridge     │  │
   │   └─────────────┘     └──────────────┘    └─────────────┘  │
   │                                                              │
   │                       GRID CLIENT                            │
   └──────────────────────────────────────────────────────────────┘
```

### 1. Identity

Computes and caches the player's display name and trail color. Pure local. Zero network. See [`design/identity-and-aesthetic.md`](../design/identity-and-aesthetic.md).

### 2. Input

Reads keypresses from the terminal in raw mode (pilot mode) or reads commands from a daemon subprocess's stdout (daemon mode). Both produce the same internal `Input` events: `TURN_LEFT`, `TURN_RIGHT`, `EXIT`, etc.

### 3. Determinism (game logic)

The pure functional core of GRID. Takes the current grid state and a set of inputs for the current tick, returns the next grid state. Integer math only. Deterministic RNG with explicit seeds. No floating point. No platform clocks. Identical inputs on identical state produce identical output on every machine, every time. See [`determinism.md`](determinism.md).

### 4. Networking

Establishes WebRTC peer connections to other players in the same neighborhood. Discovers peers via Nostr public relays. Exchanges per-tick input messages and periodic state-hash messages. Handles peer joins, leaves, and neighborhood routing. See [`networking.md`](networking.md).

### 5. Renderer

Reads the current grid state and draws it to the terminal using box-drawing characters and 24-bit ANSI color. Handles the digitization intro animation, the play view, the spectator overlay, and the exit epitaph. See [`design/identity-and-aesthetic.md`](../design/identity-and-aesthetic.md).

### 6. Persistence

Manages the day's grid state across rounds and across player sessions. Handles the midnight UTC reset. Writes the day's recap to the public archive. Reads the archive when a new player joins mid-day to sync the current grid state. See [`persistence.md`](persistence.md).

### 7. Daemon subprocess bridge

(v0.2 feature; the *protocol* is in v0.1, the bridge is not.) Launches a daemon subprocess from a user-supplied path, pipes serialized grid state to its stdin, reads commands from its stdout, relays them as inputs to the determinism core. See [`protocol/daemon-api.md`](../protocol/daemon-api.md).

## Data flow per tick

A single tick (10 per second) flows through the system as follows:

1. **Input collection.** The local input system reads any pending keypresses or daemon commands. This produces zero or one `Input` events for the local player this tick.
2. **Input broadcast.** The local input is sent to every peer in the neighborhood via the WebRTC mesh as an `INPUT` message tagged with the current tick number.
3. **Input wait.** The local client waits until it has received `INPUT` messages from every peer for this tick. (Lockstep — the simulation cannot advance until all inputs are present.)
4. **Simulation.** The determinism core runs one tick: applies all inputs, advances all cycles, resolves collisions, applies decay, produces the next grid state.
5. **State hash.** Every Nth tick (default N=30, i.e., every 3 seconds), the local client computes a hash of the current grid state and broadcasts it. Peers cross-check hashes; mismatched peers are evicted by majority vote.
6. **Render.** The renderer redraws any cells that changed this tick (dirty-rect rendering — full-screen redraws are too expensive at 10fps over 24-bit color).
7. **Sleep.** The client sleeps until the next tick deadline.

The total tick budget is ~100ms. Networking, simulation, and rendering must all fit. Lockstep means the *slowest* peer dictates pace, so if a peer is consistently slow, it gets dropped.

## Decentralization story

GRID has **no central infrastructure that the original authors operate**. The decentralization is true at multiple levels:

- **Game logic:** runs on every peer locally. No game server.
- **Matchmaking / discovery:** rides on public Nostr relays (interchangeable, many, operated by different people). No matchmaking server.
- **State authority:** lockstep simulation means every peer is a full replica. No authoritative server.
- **Anti-cheat:** local consensus among peers via state-hash voting. No authoritative server.
- **Identity:** derived locally from the player's machine. No identity server.
- **Persistence:** the daily grid state is held collectively by peers in the day's mesh; the daily archive is written to a public git repository (or IPFS, or a Nostr long-form post — the medium is replaceable). No state server.

There are exactly two pieces of external infrastructure GRID *uses*:

1. **The npm registry** (or PyPI for the eventual Python port). For initial download. After bootstrap, the package is cached locally and updates only when the user runs `npx grid` again (which fetches the latest unless `npx grid@1.0.0` is pinned).
2. **STUN servers** for WebRTC NAT traversal. Public STUN servers (Google, Cloudflare, others) are interchangeable and free. A future TURN fallback is *possible* if needed for restrictive NATs but is not required for v0.1.

Neither of these is operated by the GRID authors. Both can fail and be replaced without anyone updating GRID's code, because both are public commons of the modern internet.

## What this architecture enables

The architecture is designed to make four things true:

1. **GRID has no operator.** The original authors can disappear from the project tomorrow and GRID continues to work, indefinitely, as long as Nostr relays exist and players exist.
2. **GRID has no operating cost.** There is nothing to host, nothing to scale, nothing to bill. The cost of running GRID for one million players is the same as the cost of running it for ten: zero.
3. **GRID cannot be censored or shut down.** No single entity (including the authors) has a kill switch. The closest a hostile actor can come is poisoning a few Nostr relays, which players route around automatically.
4. **GRID's source of truth is the players themselves.** The state of the grid right now is whatever the active peers collectively believe it is. There is no other answer.

These are rare properties in modern gaming. They are the reason GRID is built this way and not as a normal client-server multiplayer game.

## What this architecture costs

Honest list of trade-offs the user should know about:

- **No global state.** GRID cannot have a worldwide leaderboard, a friends list, a chat across regions, or any feature that requires authoritative global state. The design embraces this; it is a *constraint* that shapes the goal system (see [`goals.md`](../design/goals.md)).
- **Lockstep latency.** The simulation runs at the speed of the slowest peer in the neighborhood. Players with bad connections drag the room. Mitigation: hard timeout on input wait (~150ms), then drop the slow peer.
- **Mesh size limit.** Full-mesh WebRTC scales to ~6–10 peers before quadratic connection growth becomes painful. Neighborhoods are capped at 6 active programs. Larger gatherings happen in parallel neighborhoods.
- **Cold-start fragility.** A first-time player on day one with no other players online sees an empty grid. The mitigation is that bots fill the world: any daemon left running by any player keeps the grid populated for everyone.
- **No anti-cheat against collusion.** A coordinated group of cheaters running a forked client could agree on fake state hashes and outvote honest peers in their neighborhood. This is acceptable because there is nothing valuable to cheat for: no rank, no money, no items. The design makes cheating *pointless*, not impossible.

## See also

- [`networking.md`](networking.md) — peer connection, signaling, neighborhoods
- [`determinism.md`](determinism.md) — lockstep simulation, hashing, anti-cheat
- [`persistence.md`](persistence.md) — daily grid, midnight reset, archive
- [`../protocol/wire-protocol.md`](../protocol/wire-protocol.md) — peer-to-peer message format
- [`../protocol/daemon-api.md`](../protocol/daemon-api.md) — daemon stdin/stdout protocol
