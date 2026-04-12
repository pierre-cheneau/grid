# Networking

GRID's networking has two layers: **discovery** (how peers find each other without a server) and **transport** (how peers exchange game data once connected). Both are designed to require no infrastructure that the GRID authors operate.

## Discovery: Nostr as the signaling channel

WebRTC requires a *signaling* step before two peers can talk: each peer needs to learn the other peer's SDP offer/answer and ICE candidates. Normally this is done by a small signaling server. GRID uses **public Nostr relays** as the signaling channel instead.

### How it works

1. The GRID client connects to 3–5 hardcoded public Nostr relays at startup (see the pinned list in "Implementation notes for v0.1" below).
2. The client subscribes to a channel keyed by today's grid identifier — for v0.1, simply `grid:YYYY-MM-DD-UTC`.
3. The client publishes a Nostr event containing its WebRTC SDP offer and a tag identifying which neighborhood it wants to join (or "any").
4. Other clients subscribed to the same channel see the offer, decide whether to respond (based on their own neighborhood capacity), and publish an SDP answer as a reply event.
5. The two clients exchange ICE candidates over the same channel until a direct WebRTC connection is established.
6. Once connected, **all game data flows over the direct WebRTC connection.** Nostr is only used for the initial handshake.

### Why Nostr

- **It already exists, with many independent operators.** Hundreds of public Nostr relays are operated by unrelated people for unrelated reasons. They are free, persistent, and exactly designed for "post a small message anyone can read."
- **It is not centralized.** Any client can connect to any relay. If three of GRID's hardcoded relays go down, the other two still work. If all five go down, players can supply their own with `--relay wss://my.relay`.
- **It is small.** A Nostr signaling event is a few hundred bytes. The total Nostr traffic per player session is on the order of kilobytes.
- **The Nostr operators don't know or care.** GRID's signaling traffic is indistinguishable from any other Nostr message and is well within free-tier rate limits.

### Decentralization stance

No peer-to-peer system achieves zero-infrastructure discovery over the open internet. Two strangers need *some* rendezvous point to find each other. Every P2P system solves this with seed infrastructure: BitTorrent has trackers and DHT bootstrap nodes, Bitcoin has hardcoded seed nodes, IPFS has Protocol Labs' bootstrap nodes, Tor has 9 directory authorities.

Nostr relays are the **lightest, most replaceable** form of this seed infrastructure:

- **GRID authors do not operate any relay.** The hardcoded relay URLs point to infrastructure run by unrelated third parties for the general Nostr ecosystem. GRID piggybacks on infrastructure it doesn't control or pay for.
- **Relays are fungible.** Any Nostr relay that implements NIP-01 works. There are 500+ public relays today. Swapping one for another requires no code change — only a `--relay` flag.
- **Anyone can run a relay.** A single Go/Rust binary, ~$5/month on a VPS. Community-run relays are the path to full self-sovereignty.
- **Relays are only the signaling layer.** Once WebRTC connects, the relay is out of the data path entirely. All game traffic flows direct peer-to-peer. The relay never sees game state, never authenticates, never makes decisions.
- **Relay failure is tolerable.** 5 relays are contacted; any 1 working is enough. All 5 failing simultaneously requires 5 independent operators to be down at the same moment.

The meaningful question is not "is there infrastructure?" (there always is), but "can any single entity kill it, and can anyone provide it?" Nostr meets both tests. GRID's decentralization is genuine.

**Scaling path for discovery:**

| Version | Discovery mechanism | Scales to |
|---|---|---|
| v0.1 | 5 pinned Nostr relays + Trystero rooms | ~50 concurrent players, ~8 neighborhoods |
| v0.2 | `nostr-tools` signaling + proximity WebRTC, tile-sharded Nostr topics | ~10,000 players |
| v0.2+ | + relay federation (tile-range → relay mapping in world config) | ~100,000 players |
| v0.3 | + DHT discovery (Kademlia via libp2p), relays become optional | Unlimited |

Each step is additive — no rewrite needed. The tile and topology abstractions isolate the discovery layer from the game logic so the underlying mechanism can change without touching the simulation, renderer, or CLI.

### Trystero (v0.1 only)

[Trystero](https://github.com/dmotz/trystero) is used in v0.1 for WebRTC signaling via Nostr. It provides room-scoped peer discovery and WebRTC connection management.

**v0.2 replaces Trystero** with direct `nostr-tools` signaling + `node-datachannel` WebRTC. The reason: Trystero's room abstraction forces a fixed-membership mesh topology. v0.2's proximity-based topology requires any-to-any connections that form and dissolve dynamically based on spatial proximity. `nostr-tools` is already required for the persistence layer, so using it for signaling too eliminates a dependency while gaining full topology control.

## Transport: WebRTC mesh

Once peers are connected, all game data flows over **WebRTC data channels** in unreliable-unordered mode. UDP-like semantics, no head-of-line blocking, low latency.

### Channel layout (v0.1)

v0.1 negotiates exactly **two** Trystero data channels per peer:

| Label | Reliability | Carries |
|---|---|---|
| `ctrl` | reliable, ordered | HELLO, EVICT, STATE_REQUEST, STATE_RESPONSE, KICKED, BYE |
| `tick` | unreliable, unordered | INPUT, STATE_HASH |

All other channel labels are reserved for future protocol versions. The wire-protocol message types and their channel assignment are defined in [`../protocol/wire-protocol.md`](../protocol/wire-protocol.md).

### Why WebRTC

- **Direct peer-to-peer.** No relay in the data path. Latency is whatever the underlying internet path is.
- **NAT traversal handled.** WebRTC does ICE/STUN/TURN out of the box. Most home NATs are traversed without TURN.
- **Browser-compatible.** A future browser GRID client (or a debug visualizer) could connect to the same mesh without protocol changes.
- **Encrypted by default.** WebRTC data channels use DTLS. End-to-end encrypted between peers without GRID having to think about it.

### The mesh topology

GRID uses a **full mesh** within each neighborhood. Every peer is directly connected to every other peer in the same neighborhood. Inputs are broadcast to all peers; the local simulation processes all inputs from all peers including itself.

```
        peer A ─────── peer B
          │ \         / │
          │  \       /  │
          │   \     /   │
          │    \   /    │
          │     \ /     │
          │      X      │
          │     / \     │
          │    /   \    │
          │   /     \   │
          │  /       \  │
          │ /         \ │
        peer C ─────── peer D
```

This works well up to 6 peers. Beyond that, the number of connections grows quadratically (`n*(n-1)/2`), and each peer's upload bandwidth becomes the bottleneck.

### The 6-peer cap

Neighborhoods are capped at **6 active programs**. The cap is a hard architectural constant in v0.1. When a 7th player tries to join a neighborhood that is full, they are routed into a sibling neighborhood (see "neighborhoods" below).

This cap is the load-bearing reason GRID's architecture works without a server. With a 6-peer mesh, every peer has 5 outgoing connections, each pushing ~1KB/s of game data, for a total upload of ~5KB/s per player. This is comfortable on any consumer connection. With 60 peers in a single mesh, every peer would need 59 connections at ~60KB/s upload, which fails on most home connections.

The cap is not a limitation; it is the *property that makes the design work*.

## Neighborhoods (v0.1) → Direct WebRTC mesh (Stage 10) → Proximity topology (Stage 12+)

### v0.1: Fixed neighborhoods (Trystero-managed)

v0.1 uses a **neighborhood** model: a 6-peer fully-meshed cluster within today's grid. All peers in a neighborhood share the same lockstep simulation. Discovery and signaling go through Trystero's Nostr strategy.

### Stage 10: Direct WebRTC mesh (Trystero replacement)

Stage 10 replaces Trystero's transport without changing the lockstep semantics. Every peer in the day's room (`grid:YYYY-MM-DD`) gets a direct WebRTC connection to every other peer; all peers are in lockstep together. The differences from v0.1 are purely about WHO controls the transport:

- **Discovery**: Nostr presence events (kind 20078) tagged `['x', 'grid:${dayTag}']`. Subscribers filter via `#x`. Replaces Trystero's internal presence mechanism with one we control end-to-end.
- **Signaling**: WebRTC SDP/ICE exchanged via Nostr ephemeral events (kind 20079) tagged `['p', targetPubkey]`. Initiator selection by lex compare of pubkeys (lower wins).
- **Transport**: `RTCPeerConnection` from `node-datachannel/polyfill` (the W3C-compatible polyfill), used directly. Two data channels per peer: `ctrl` (reliable, ordered) and `tick` (unreliable, unordered).
- **Mesh management**: a `NostrRoom` class implements the same `Room` interface NetClient already consumes. NetClient changes zero lines.

The 6-peer cap from v0.1 still applies (WebRTC mesh bandwidth constraint). At v0.2 scale (~10 concurrent players in a 250×250 world) this is fine — the world is small enough that all players naturally cluster in one mesh.

### Stage 12+: Proximity-based dynamic lockstep (deferred)

The original v0.2 plan bundled Stage 10 with **dynamic proximity-based lockstep formation** — peers within ~30 cells would form lockstep, peers who moved apart would drop to a gossip-only mode. This is genuinely powerful for scaling beyond the 6-peer cap, but it has five hard distributed-systems problems:

1. **State sync between independently-simulating peers**: when two peers form lockstep, whose state is canonical? Both have valid but slightly different states (cells, tick counter, RNG).
2. **Hash-check eviction during CRDT propagation lag**: cell snapshots take seconds to propagate via Nostr; if two peers form lockstep before they've fully merged, hash check immediately evicts one of them.
3. **Stale snapshot views**: when a senior peer sends STATE_RESPONSE to a re-joining peer, the snapshot contains the senior's view of the junior — which is stale. The junior must inject their actual current position.
4. **Transitive vs. non-transitive lockstep groups**: A is in range of B, B is in range of C, but A is not in range of C. Are A, B, C all in one lockstep group? Or two overlapping pairs?
5. **Re-convergence after long separation**: two peers walk far apart (run independently for minutes), then walk back together. State sync must reconcile minutes of independent simulation.

At v0.2 scale (≤10 players in a 250×250 world) almost all players stay in lockstep range continuously, so the additional complexity buys nothing. The architecture remains **fully prepared** for proximity dynamics:
- `Lockstep` is topology-agnostic (`addPeer`/`removePeer` are dynamic).
- `HashCheck` works with any peer subset.
- `Room` interface already supports per-peer routing via session id.
- `PresenceTracker` (Stage 10) is the foundation for position-based decisions.

Stage 12+ adds proximity dynamics when player counts and world size justify the complexity.

## Time-anchored ticks

The simulation's tick number is derived from real time:

```
dayStartMs = midnight UTC today, in milliseconds
tickAtTime(t) = floor((t - dayStartMs) / TICK_DURATION_MS)
```

This anchoring means the lockstep targets the real-time tick rather than advancing at an arbitrary pace. During active play, the pacing is identical to before (10 tps). The difference is that the tick NUMBER corresponds to a specific moment in the day, so:

- Cells decay in real time even when no peers are online.
- A returning peer knows the correct tick from the wall clock alone.
- Cross-room coordination (v0.2) is trivial — all rooms use the same clock.

The simulation core (`src/sim/`) remains pure — it doesn't know about wall clocks. The networking layer enforces the alignment. See [`persistence.md`](persistence.md) for the full time-anchored persistence model.

## Connection phase

The time between `npx grid` and "you are playing" has specific behavior that prevents state divergence:

1. The lockstep starts **paused**. No simulation ticks run. The renderer shows "connecting to room..." while Trystero negotiates the WebRTC handshake via Nostr relays (~2–8 seconds depending on relay latency).
2. **If a peer connects** and the HELLO exchange determines seniority:
   - The **senior** (earliest `joined_at`) unpauses immediately and starts ticking. Their state is canonical.
   - The **junior** stays paused, sends `STATE_REQUEST`, receives `STATE_RESPONSE` (a base64-encoded canonical snapshot), installs it, and unpauses. Both peers are now at the same tick with identical state.
3. **If no peer connects within 8 seconds** (the seed timeout), the player is the seed of a new neighborhood. The lockstep unpauses and they tick alone. Late joiners sync to them via the same STATE_REQUEST/RESPONSE flow.

The intro animation overlaps with the WebRTC handshake so the ritual IS the connection wait. See [`../design/identity-and-aesthetic.md`](../design/identity-and-aesthetic.md) for the animation details.

## Cold-start handling

A first-time player on day one with nobody else online sees an empty discovery channel. GRID handles this by:

1. The client connects to Nostr relays and looks for active neighborhoods.
2. Finding none, it fetches the latest cell snapshot from Nostr (if available) and reconstructs the world with real-time decay applied. If no snapshot exists, the grid starts empty.
3. The client creates the first neighborhood and waits during the intro animation (~12s).
4. After the seed timeout, the lockstep unpauses at `tickAtTime(now)` — the simulation's tick is anchored to real time. The player enters a world that may already contain decaying trails from earlier sessions.
5. When a second player arrives, the discovery layer connects them and the junior installs the senior's state via STATE_REQUEST/STATE_RESPONSE.

Empty grids are not failure states. They are how the world starts each day in low-population periods. But a grid with decaying trails from earlier players is the *expected* state — the world remembers.

## Failure modes

Honest list of what can go wrong:

- **All Nostr relays unreachable.** Player cannot discover peers. GRID prints an error and exits with a hint to try again or supply `--relay`. Mitigation: hardcoded list of 5 relays; failure requires all 5 to be down simultaneously.
- **Peers connect to different relay subsets and never see each other.** If Trystero picks random relays from its default pool, two peers can end up on disjoint subsets. Mitigation: v0.1 pins an explicit small relay list so ALL peers use the SAME relays. The `--relay` override lets players route around a bad relay.
- **Restrictive NAT prevents WebRTC connection.** Two peers see each other via Nostr but cannot establish a direct data channel. v0.1: the connection times out and the player joins a different neighborhood (or creates their own). v0.2: optional TURN relay fallback.
- **Lockstep stalls because one peer is temporarily slow.** The lockstep waits up to 150ms (`INPUT_TIMEOUT_MS`) past the tick deadline, then defaults the missing peer's input to `''` (straight, no turn). After 3 consecutive timeouts for the same peer (`CONSECUTIVE_TIMEOUT_THRESHOLD`), that peer is **auto-defaulted with zero wait** on all subsequent ticks — the game runs at full 10 tps for everyone else while the slow peer's cycle drifts straight on autopilot. This is softer than immediate eviction and handles transient slowness gracefully.
- **A peer's process freezes (Windows Quick Edit, laptop sleep, debugger).** If the wall-clock jumps by more than 2 seconds (`FREEZE_THRESHOLD_MS`) between two `runOnce` calls, the client detects a freeze, pauses its own lockstep, and sends `STATE_REQUEST` to the most-senior peer. The senior responds with a fresh snapshot and the frozen peer re-syncs — identical to the joiner flow. The non-frozen peers were running at full speed the entire time (via auto-default) so no one was impacted.
- **State hash mismatch.** A peer's state hash diverges from the others. That peer is evicted and asked to re-sync from a known-good peer. If it cannot, it is dropped.
- **All peers in a neighborhood disconnect simultaneously.** The last peer publishes a cell snapshot to Nostr and writes a local backup before exiting. The next peer to arrive reconstructs the world from the snapshot with real-time decay applied. If the exit was unclean (crash, kill -9), the periodic 60-second snapshots limit data loss to at most one minute of cell history.

None of these failures are recoverable in the traditional "the server handled it" sense. They are recoverable in the *peer-to-peer* sense: the network repairs itself by routing around damage, and individual sessions occasionally lose state in exchange for the property that there is no operator.

## Bandwidth budget

Approximate per-player budget at 10 ticks per second in a full 6-peer mesh:

- **Per tick:** 1 INPUT message out, 5 INPUT messages in. ~10 bytes each = 60 bytes/tick.
- **Per second:** 600 bytes/s of input traffic.
- **State hashes:** every 30 ticks, 1 hash out, 5 in. ~32 bytes each. Trivial.
- **Periodic state syncs (joiners):** ~10KB transmitted to each new joiner, ~once per minute when there is churn.
- **Total steady state:** under 5KB/s per player. Comfortably below any modern consumer connection.

## Implementation notes for v0.1

- Use **Trystero with the Nostr strategy**, configured with a room key derived from today's UTC date.
- Cap the room at 6 peers. Joiner-7 should create a sibling room with key suffix `-b`, `-c`, etc.
- Use a single Nostr discovery topic (`grid:YYYY-MM-DD`) for all sibling rooms.
- Persistent state sync via `STATE_REQUEST`/`STATE_RESPONSE`. See [`../protocol/wire-protocol.md`](../protocol/wire-protocol.md).
- **Pinned Nostr relays for v0.1** (passed explicitly to Trystero's `relayUrls` config):
  ```
  wss://relay.primal.net
  wss://relay.notoshi.win
  wss://relay.mostr.pub
  wss://relay.nostr.net
  wss://nostr.fmt.wiz.biz
  ```
- Hardcode Google's STUN servers. Allow override with `--stun`.
- **Node.js WebRTC polyfill**: `node-datachannel` supplies `RTCPeerConnection` for Node. Single import site: `src/net/room.ts`.

## Implementation notes for v0.2

- **Replace Trystero with `nostr-tools`** for all Nostr interactions (signaling, persistence, presence). `nostr-tools`'s `SimplePool` manages connections to multiple relays with reconnection and deduplication.
- **WebRTC signaling via Nostr**: exchange SDP offers/answers and ICE candidates as Nostr ephemeral events (kind 20079), tagged `['p', targetPubkey]`. Subscribers filter via `'#p': [myPubkey]`. Initiator selection by lex compare (lower pubkey wins).
- **`node-datachannel/polyfill`** is used directly. Standard W3C `RTCPeerConnection` API (`createOffer`, `setLocalDescription`, `addIceCandidate`).
- **Peer discovery**: Nostr presence events (kind 20078) tagged `['x', 'grid:${dayTag}']`. Each peer publishes own presence every 3s. Subscribers filter via `'#x': ['grid:${dayTag}']` to find all peers in today's room. Peer is considered lost after 15s without presence.
- **Two data channels per peer**: `ctrl` (reliable, ordered) carries HELLO/EVICT/STATE_REQUEST/STATE_RESPONSE/KICKED/BYE; `tick` (unreliable, unordered) carries INPUT/STATE_HASH. Same channel labels and semantics as Trystero.
- **Pinned Nostr relays for v0.2** (same list, passed to `nostr-tools` SimplePool):
  ```
  wss://relay.primal.net
  wss://relay.notoshi.win
  wss://relay.mostr.pub
  wss://relay.nostr.net
  wss://nostr.fmt.wiz.biz
  ```
- **Tile topics** (Stage 9): `grid:YYYY-MM-DD:t:X-Y` for cell snapshots (kind 30079) and chain attestations (kind 22770).
- **Relay federation** (Stage 12+): world config event includes optional relay map. Default: all tiles → same 5 relays. At scale: tile ranges → dedicated community-run relays.
- **Connection budget per peer (Stage 10)**: one WebRTC connection per peer in the day's room, all in lockstep. Same 6-peer cap as v0.1 due to mesh bandwidth constraints. Stage 12+ relaxes this with proximity-based dynamic mesh formation.
