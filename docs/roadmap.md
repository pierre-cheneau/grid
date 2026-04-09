# Roadmap, scope, and risks

This document defines what GRID v0.1 is, what it explicitly is *not*, the build stages to get there, and the known risks. It is the contract between the design and the implementation.

## v0.1 — the smallest version that contains the soul

The v0.1 goal is **a single demonstrable build that contains the soul of the GRID concept**, not a complete feature set. Anything that is essential to the *feeling* of GRID is in v0.1. Anything that can be added later without changing the feeling is not.

### v0.1 must have

| Item | Why |
|---|---|
| `npx grid` runs from a clean machine in <10 seconds | The doorway. Ten seconds is the cap. |
| Digitization intro animation, doubling as connection wait | The threshold ritual. Non-skippable. |
| Pilot mode with arrow-key cycle controls | The primary verb. |
| 90-second informal session loop with instant respawn | The coffee-break shape. |
| Viewport camera + 24-bit ANSI color renderer, top-down view | The aesthetic. |
| WebRTC peer connection via Trystero (Nostr strategy) | The decentralization. |
| Lockstep deterministic simulation | The foundation. Everything binds to this. |
| State-hash cross-checking with peer eviction | The anti-cheat / consistency. |
| One global daily world (`grid:YYYY-MM-DD`), sized by yesterday's population | The shared place. |
| Up to 6 peers per neighborhood, auto-shunt to siblings | The mesh limit. |
| Player identity from `${USER}@${HOSTNAME}` with hashed color | The identity model. |
| Persistent grid state via Nostr + local backup, survives peer-free gaps | The "place not match" feeling. |
| Decay physics (first-guess calibration) | The breathing world. |
| Midnight UTC reset with local recap | The daily ritual. |
| Exit epitaph in shell scrollback | The session closure. |
| Wire protocol fully designed and documented | Daemon-readiness. |
| Daemon API fully designed and documented | Daemon-readiness, even though the bridge is v0.2. |
| `AGENTS.md` at the project root | LLM-facing daemon reference. Used by AI coding assistants today, by `npx grid forge` in v0.2. Freezes the LLM context early. |

### v0.1 must NOT have

| Item | Why deferred |
|---|---|
| Daemon mode (subprocess bridge) | The protocol exists; the bridge is v0.2. v0.1 ships pilot-only to validate the loop. |
| `npx grid forge` (LLM daemon authoring) | Depends on the daemon bridge. v0.2 alongside it. `AGENTS.md` ships in v0.1 to freeze the LLM context. See [`design/forge.md`](design/forge.md). |
| All five crowns | v0.1 ships one crown (Last Standing). The other four are v0.2. |
| The public archive | v0.1 logs the local recap and publishes to Nostr. The git-backed archive is v0.2. |
| `uvx grid` Python port | v0.1 is Node only. Python comes after the protocol is frozen. |
| Multi-region grids | v0.1 is one global grid. Regional sharding is v0.3+. |
| Full neighborhood routing | v0.1 picks the first available neighborhood. Smarter routing is v0.2. |
| Replay-sharing UI | The replay format is part of the protocol; the share UI is v0.2. |
| Spectator camera panning | Press `Tab` toggles spectator-on-current-position only in v0.1. Free camera is v0.2. |
| Cross-neighborhood gossip | v0.1 neighborhoods are isolated within the day. Inter-gossip is v0.2. |
| Isometric tilted renderer | Top-down only in v0.1. Tilt is v0.2. |
| 3D ASCII cinematic mode | Far future, possibly never. |
| TURN relay fallback | Players behind restrictive NATs are documented as a known limitation. |
| Achievement system, cosmetics, badges, levels | Out of scope forever. |
| Account system, social features, friends list | Out of scope forever. |
| Monetization of any kind | Out of scope forever. |

### v0.1 success criteria

GRID v0.1 is successful when:

1. **A new player on a fresh machine** can type `npx grid`, see the intro, play the game, and exit gracefully — all without reading any documentation, without creating an account, and within 30 seconds of typing the command for the first time.
2. **Two players on different machines** can join the same daily grid, see each other's cycles in real-time, and have one derez the other.
3. **Three or more players** can play in the same neighborhood for 10 minutes without a desync.
4. **The daily reset** at midnight UTC works: the grid is reset, a recap is computed and printed.
5. **The exit epitaph** appears in the player's shell scrollback after they exit.
6. **The wire protocol and daemon API** are documented well enough that a third party could write a daemon for the v0.2 bridge before the bridge exists.

That is the entire v0.1 bar. Anything beyond is bonus and should be deferred.

## Build stages

Implementation should proceed in stages, each stage producing testable working software. Stage N must work before stage N+1 begins. Out-of-order work creates dependencies that bite later.

### Stage 1: determinism core ✅

Pure logic, no networking, no UI, no terminal.

- Define the simulation state types: `GridState`, `Player`, `Cell`, `Inputs`, `Config`.
- Implement `simulateTick(state, inputs) -> state` as a pure function.
- Implement deterministic PRNG (PCG32 or splitmix64).
- Implement decay logic.
- Implement state serialization (canonical, sorted) and SHA-256 hashing.
- Write property-based tests: random sequences of inputs produce identical results when run twice.
- Add a CI test that runs the simulation on Linux + Windows and verifies identical final state hashes.

**Done when:** the simulation runs in a Node REPL and produces deterministic state across two machines.

**Shipped.** Cross-platform hash `36f5919d650009ef` verified on Linux + Windows CI. 74 tests (unit + 6 properties + pinned scenario).

### Stage 2: terminal renderer ✅

Reads simulation state, draws to terminal. No interactivity yet.

- ~~Set up the chosen TUI library (recommended: Ink or blessed).~~ Hand-rolled ANSI escapes, zero deps.
- Implement the box-drawing renderer for the grid floor.
- Implement cycle rendering with hashed RGB colors (neon-bright from colorSeed).
- Implement trail rendering with decay-aware character/color fading (`█▓▒░` + fade toward black).
- Implement HUD elements (player name, score, tick, hash).
- Wire the renderer to the NetClient state stream so it animates at 10fps.

**Done when:** a hardcoded simulation plays back visually in a terminal at 10fps.

**Shipped.** Built out of roadmap order (after Stage 5) so netcode could be validated visually. Alt-screen mode, synchronized output, TTY fallback for piped output. 165 tests total.

### Stage 3: local pilot mode

Wire keyboard input to the simulation. Single-player on a local grid.

- Implement raw-mode keyboard reading (arrow keys, WASD, `q`).
- Connect input events to the simulation as the local player.
- Run the simulation loop in real time at 10 ticks/sec.
- Implement respawn after 3-second countdown.
- Implement graceful exit on `q` / Ctrl-C.

**Done when:** a single player can play GRID against an empty grid (or against themselves with multiple respawns).

### Stage 4: identity and intro

Add the digitization ritual and the identity model.

- Implement the identity computation: `${USER}@${HOSTNAME}` and color hashing.
- Cache identity to `~/.grid/identity.json`.
- Implement the intro animation (Matrix-rain with player's own characters, ~1.5s).
- Implement the exit epitaph that prints to scrollback after alternate-screen exit.
- Tune the intro to feel ritual, not mechanical.

**Done when:** the launch and exit experience feels like a place you visit, not a program you run.

### Stage 5: P2P netcode ✅

Trystero, Nostr, lockstep, state hashes.

- Set up Trystero with the Nostr strategy and the daily room key. `node-datachannel` polyfill for Node.
- Implement the wire protocol message types (`HELLO`, `INPUT`, `STATE_HASH`, `STATE_REQUEST`, etc.).
- Implement lockstep input collection: wall-clock paced at 10 tps, 150ms timeout for missing inputs.
- Implement consecutive-timeout auto-default (3 missed ticks → instant default, full-speed game for everyone else).
- Implement freeze detection + STATE_REQUEST re-sync (Windows Quick Edit, laptop sleep).
- Implement state-hash broadcasting and cross-checking every 30 ticks.
- Implement peer eviction by EVICT vote (strict majority quorum).
- Implement joiner sync via STATE_REQUEST / STATE_RESPONSE (base64 of canonical bytes).
- Implement connection phase: lockstep starts paused; junior waits for snapshot; senior unpauses on HELLO; seed timeout for solo play.

**Done when:** two players on different machines see each other's cycles in real-time and one can derez the other.

**Shipped.** Built second (before Stage 2) to lock the deterministic netcode foundation. Two-terminal lockstep verified hash-identical at every tick. Immediate-broadcast-on-keypress eliminates the input-race divergence. 165 tests including in-process MockRoom integration.

### Stage 6: persistence within the day

The world becomes a living place that remembers. Four deliverables:

**6a. Self-describing cells (FORMAT_VERSION 2).** Add `colorSeed` to the `Cell` type so orphaned trails keep their identity color. Update canonical serialization, determinism hash, all pinned tests.

**6b. Time-anchored ticks.** Anchor tick numbers to real time via `tickAtTime(now, dayStartMs)`. The lockstep paces toward the real-time target. Cells decay whether or not anyone is online.

**6c. Viewport camera.** The world is larger than the terminal. The camera follows the player's cycle. The world scrolls. World boundary rendered as cyan wall when visible; void (black) beyond. No bordered rectangle — the player IS inside the grid. Intro Phase 6 (grid-draw) removed; the vortex transitions directly into the world.

**6d. Persistence layer (`src/persist/`).** Compact binary cell snapshots (14 bytes/cell), compressed. Published to Nostr on shutdown + periodic. Local backup to `~/.grid/`. Cold-start reconstruction from Nostr or local file with real-time decay applied. Hash chain published every 300 ticks for cryptographic integrity. Nostr keypair in identity cache. World config event published at midnight.

- Benchmark compression algorithms (gzip, brotli, raw deflate) on cell data and select the best.
- Verify trails from exited players persist and keep their color.
- Verify cold start with Nostr persistence reconstructs the world correctly.
- Verify the hash chain is verifiable across independent signers.

**Done when:** the grid you arrive in is shaped by what other people did before you — even if no one has been online for an hour.

### Stage 7: midnight reset and local recap

The daily ritual.

- Implement the midnight UTC trigger.
- Compute the day's contributions (kills, longest run, cells).
- Compute the Last Standing crown locally.
- Print the recap to the terminal at midnight (and to the exit epitaph).
- Reset the simulation seed for the new day.

**Done when:** GRID feels like it has a daily rhythm.

### Stage 8: polish, packaging, launch

The things that turn a tech demo into a product.

- Tune the intro animation, the colors, the decay rate.
- Test on macOS, Linux, Windows (Windows Terminal at minimum).
- Test on a mediocre coffee-shop wifi.
- Write the README. Keep it short. The doorway is `npx grid`, not the README.
- Publish to npm.
- Type `npx grid` from a fresh machine and verify the entire flow works.

**Done when:** v0.1 is shipped.

## Risks

These are the real risks, ordered by severity. None are blockers; all should shape decisions.

### 1. Engineering scope is bigger than it looks

Stages 1 through 8 are not a weekend. A clean v0.1 that actually works is more like several weekends of focused work, possibly more. The mitigation is to **stop at the first stage that produces something demoable** and decide whether to push forward. After stage 4 (identity + intro + local pilot) you have a beautiful single-player Tron clone in the terminal — that alone is shareable, gets feedback, and validates the aesthetic. The networking stages (5–7) are the harder half.

Recommendation: ship a single-player "preview" build after stage 4. Use it to test the aesthetic with real users before investing in the netcode.

### 2. Determinism bugs are subtle and expensive

The simulation must be bit-identical across machines. The most common cause of subtle desyncs is something innocuous like JavaScript object iteration order, floating-point creep, or platform-specific time. The mitigation is the cross-platform CI test (Linux + Windows) running the simulation and comparing hashes. **Set this up in stage 1**, before the simulation gets complex. Once it's complex, finding the source of a desync is excruciating.

### 3. Decay calibration has no theoretical answer

How fast trails should decay is a tuning problem solvable only by playing the game with real people for several days. Plan for the decay rate to change multiple times after launch. Accept that the first calibration will be wrong.

### 4. Cold-start chicken-and-egg

Day one of GRID has one player: you. The grid will be empty. The mitigation is to **write 3-5 seed daemons** before launching v0.1 — even though daemon mode isn't user-facing in v0.1, the *protocol* is, and you can run daemons yourself on a small VPS to populate the grid for early visitors. This is not cheating; it is seeding an ecosystem. Every successful persistent world has done this. (Note: v0.1 doesn't have the daemon bridge in the *client*, but the protocol is documented enough that you can hand-implement a daemon-runner script that uses the wire protocol directly to populate the grid. This is the v0.1.5 task right after launch.)

### 5. NAT traversal will fail for some players

WebRTC works for ~95% of players, fails for the rest (corporate firewalls, symmetric NATs). v0.1 documents this as a known issue. Players hit by it can use a different network or wait for v0.2 TURN. A small fraction of users will not be able to play — accept this rather than running infrastructure to fix it.

### 6. Disney trademark

Don't call the project Tron. Don't use the Tron logo. The neon-grid aesthetic is unprotectable but the brand is. Pick a name you own. "GRID" is fine; so are dozens of alternatives. Get a lawyer's eye on the launch announcement before posting it publicly.

### 7. The hype loop trap

Even a well-designed game can be ruined by the wrong launch story. If GRID gets a viral first day with thousands of players, the architecture will hold (decentralization scales for free) but the *culture* may not — early players set tone. Mitigation: launch quietly to a small audience first (a few subreddits, a few friends, no Hacker News). Let the culture form before exposing it to mass attention. Hype is the enemy of permanence.

### 8. The author getting bored

The single biggest reason small games die is that the author loses interest before the game finds its audience. Mitigation: scope v0.1 small enough to ship while still motivated. The smallest possible version that contains the soul. If you get to stage 4 and stop, you still have a beautiful artifact.

## v0.2 — the fully decentralized living world

v0.1 proved the soul. v0.2 proves the ecosystem: the world persists via public Nostr relays, daemons give it a heartbeat, and the architecture scales from 10 to 100,000 players without rewrites. The guiding principle: **per-player resource consumption is constant regardless of total population.**

### v0.2 build stages

#### Stage 8: Cryptographic identity + Nostr foundation

The platform everything else builds on.

- Extend `~/.grid/identity.json` with a secp256k1 Nostr keypair (secret key + derived pubkey). Generated once via `@noble/curves` (comes transitively via `nostr-tools`).
- Add `nostr-tools` as a runtime dependency (replaces Trystero's Nostr signaling role and adds persistence capabilities). Single relay pool (`SimplePool`) for all Nostr interactions.
- Implement event signing (Schnorr/BIP-340) for all outbound Nostr events.
- Implement event verification for all inbound Nostr events.
- Wire the relay pool lifecycle (connect on start, reconnect on drop, close on shutdown).

**Done when:** the identity system generates crypto keys and can publish/verify signed Nostr events to public relays.

#### Stage 9: Tile system + Nostr persistence

The world remembers across peer-free gaps.

- Implement tile abstraction: world divided into 256×256 tiles, `tileX = floor(worldX/256)`, Nostr topic per tile (`grid:YYYY-MM-DD:t:X-Y`).
- Publish signed, compressed cell snapshots to Nostr per tile every 30s (kind 30079, parameterized replaceable — old snapshots auto-replace on relay).
- Subscribe to viewport tiles + adjacent tiles for prefetching. CRDT merge incoming snapshots (union, latest tick wins per position).
- Cold start from Nostr: fetch latest snapshots for viewport tiles → verify signatures → CRDT merge → time-decay → play.
- Publish chain attestations to Nostr (kind 22770). Multi-signer verification on cold start.
- Publish world config events (kind 30078, daily, deterministic).
- Tile anchor election: longest-connected peer per tile publishes aggregated snapshots.

At current scale (250×250 world), there is exactly 1 tile. All tile code runs but trivially. When the world grows, multi-tile activates without code changes.

**Done when:** a player can quit, wait 5 minutes, rejoin, and see the decayed remnants of their previous session — reconstructed from Nostr, not local files.

#### Stage 10: Proximity topology + dynamic lockstep

The room-less architecture. Replace Trystero with direct Nostr signaling + proximity-based WebRTC connections.

- Implement WebRTC SDP exchange via Nostr ephemeral events (replaces Trystero's signaling).
- Implement proximity-based connection manager: players within ~30 cells form WebRTC lockstep connections; players who move apart disconnect. Connection budget: ~6 lockstep + ~10 gossip.
- Implement gossip overlay: peers exchange position/direction over WebRTC data channels, forward known positions with TTL to gossip neighbors. Discovers peers beyond direct connections.
- Refactor `NetClient` to manage a `Map<PlayerId, PeerConnection>` instead of a single `Room`.
- Remove Trystero dependency. The `Room` interface becomes `PeerTransport` (single peer-to-peer connection with ctrl/tick channels).
- Remove `trystero` from package.json.

**Done when:** two players in separate terminals see each other via dynamic proximity connection, with no concept of "rooms."

#### Stage 11: Daemon bridge + forge

The living world's heartbeat. Independent of the networking refactor.

- Implement subprocess model (`--deploy`): spawn child process, pipe JSON stdin/stdout, translate CMD messages into lockstep inputs.
- Implement in-process worker model (`--inprocess`): `worker_threads`, virtual stdio over `MessageChannel`.
- Implement handshake (HELLO → HELLO_ACK, 1s timeout), tick loop (TICK → CMD, 50ms budget), error handling (10 consecutive errors → eviction), 4 KiB source cap.
- Implement `npx grid forge "..."`: provider abstraction (ANTHROPIC/OPENAI/GROQ/OLLAMA), prompt assembly from AGENTS.md, sandbox runner (60s private sim), refinement flow (`--refine`, `--minimal`).

**Done when:** `npx grid --deploy ./wallhugger.js` runs a daemon in the live grid. `npx grid forge "a defensive bot"` produces, tests, and saves a daemon.

#### Stage 12: Remaining crowns + relay federation + polish

- Implement Architect crown (cell-tick area integral per player per tick).
- Implement Catalyst crown (direct causality: who placed the killing trail. Transitive chains deferred to v0.3).
- Implement Minimalist crown (daemon-only: smallest source that placed top 3 in any other crown).
- Add relay federation config: world config event includes optional relay map for tile-range → relay routing.
- Scale world size formula: `diameter = clamp(60, floor(20 * sqrt(peak)), 20000)`.
- Ship 3-5 seed daemons in `examples/daemons/`. Add `--seed` flag to auto-launch them in empty grids.
- Polish: README, npm publish, cross-platform QA.

**Done when:** v0.2 is shipped.

### v0.2 architecture summary

Two layers replace rooms:

1. **The cell layer** (CRDT, Nostr-propagated): cells are a Grow-Only Set with TTL. They merge without consensus. Propagation via signed Nostr events, sharded by spatial tile.
2. **The interaction layer** (WebRTC, proximity-based): players within collision range form temporary lockstep connections. Dynamic, forms and dissolves as players move.

Scaling is additive — each transition is a config change, not a rewrite:

| Scale | World size | Tiles | Discovery | What changes |
|-------|-----------|-------|-----------|-------------|
| 10 | 250×250 | 1 | Nostr presence | Nothing |
| 100 | 250×250 | 1 | Nostr presence | Nothing |
| 1,000 | 632×316 | 6 | Nostr presence | World size config |
| 10,000 | 2000×1000 | 32 | WebRTC gossip overlay | Add gossip module |
| 100,000 | 6320×3160 | 325 | WebRTC gossip + relay federation | Relay map config |

### v0.2 dependency changes

| Action | Package | Justification |
|--------|---------|---------------|
| Add | `nostr-tools` | Nostr protocol: events, signing, relay pool. Replaces Trystero's signaling and adds persistence. Brings `@noble/curves` transitively for Schnorr signatures. |
| Remove | `trystero` | Room abstraction is a liability in the proximity-based topology. Replaced by `nostr-tools` for signaling + `node-datachannel` for WebRTC. |
| Keep | `node-datachannel` | WebRTC polyfill for Node. Still needed for direct peer connections. |

### Discovery scaling ladder

The discovery layer scales incrementally without rewrites. Each step is additive — the spatial tile abstraction isolates the discovery mechanism from all game logic.

| Version | Discovery mechanism | Capacity |
|---|---|---|
| **v0.1** | 5 pinned Nostr relays + Trystero rooms | ~50 concurrent players, ~8 neighborhoods |
| **v0.2** | Nostr presence + proximity-based WebRTC, tile-sharded topics | ~500 players |
| **v0.2+** | + WebRTC gossip overlay for presence at density | ~10,000 players |
| **v0.2+** | + relay federation (tile-range → relay mapping) | ~100,000 players |
| **v0.3** | + DHT discovery (Kademlia via libp2p); Nostr relays become optional bootstrap | Unlimited |

At every tier, GRID authors operate zero infrastructure. Nostr relays are third-party; DHT bootstrap nodes can be community-run. The `--relay` flag ensures players are never locked out.

### The room-less topology (v0.2)

v0.1 uses fixed rooms (Trystero, 6-peer mesh, shared lockstep). v0.2 eliminates rooms entirely:

- **Tiles** route cell state. The world is divided into 256×256 tiles. Each tile has a Nostr topic. Players subscribe to tiles that overlap their viewport. Cell events flow through Nostr as a CRDT.
- **Proximity** routes player interactions. Players within ~30 cells form direct WebRTC connections for real-time lockstep. When they move apart, the connection dissolves.

There is no concept of "the room you're in." There is only the tiles you're subscribed to (for cells) and the peers you're connected to (for real-time interaction). Both emerge from your position, not from an assignment.
