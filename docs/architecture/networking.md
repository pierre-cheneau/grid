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

**Scaling path for discovery beyond v0.1:**

| Version | Discovery mechanism | Scales to |
|---|---|---|
| v0.1 | 5 pinned Nostr relays + `--relay` override | ~50 concurrent players, ~8 neighborhoods |
| v0.2 | + relay sharding by topic + gossip between siblings | ~500 players |
| v0.3 | + DHT discovery (Kademlia via libp2p), relays become optional | Thousands+ |

Each step is additive — no rewrite needed. The `Room` abstraction in `src/net/room.ts` isolates the discovery layer from the game logic so the underlying mechanism can change without touching the simulation, renderer, or CLI.

### Why not Trystero

[Trystero](https://github.com/dmotz/trystero) is the obvious off-the-shelf library for this and is genuinely excellent. **GRID v0.1 should use Trystero with the Nostr strategy** — there is no reason to reinvent the signaling layer when a battle-tested library exists. The implementation should be: `import { joinRoom } from 'trystero/nostr'` and let Trystero handle the SDP/ICE dance. The above paragraphs describe the *underlying mechanism*; the *implementation* is "use Trystero with the Nostr strategy and configure the room key as `grid:YYYY-MM-DD-UTC`."

If Trystero's API limits become a problem (custom routing, neighborhood logic), the fallback is to drop to raw Nostr-WS, which is also straightforward.

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

## Neighborhoods

A **neighborhood** is a 6-peer fully-meshed cluster within today's grid. The grid is logically one shared world, but physically partitioned into many neighborhoods that interconnect via gossip.

### Local interactions

Within a neighborhood:

- All cycles fight in real time via lockstep simulation.
- All trails, kills, structures are immediately visible.
- Latency is direct peer-to-peer (typically <100ms).
- The crown contributions of all 6 peers are computed locally.

### Cross-neighborhood interactions

Between neighborhoods:

- Crown totals, decay clocks, and global recap data are *gossiped* between neighborhoods via a slower, eventually-consistent channel (a separate Nostr topic, or a shared CRDT).
- A player traveling to the edge of their neighborhood's grid region is *handed off* to the next neighborhood: the WebRTC connection to the old neighborhood is torn down, a new connection to the next neighborhood is established, and the player's cycle continues with no gameplay interruption (a brief network blip is acceptable).
- Neighborhoods do not need to be aware of each other's tick-by-tick state. They share only summary data: who killed whom, what crowns are held, what the day's totals look like.

### Neighborhood routing

When a new player joins today's grid, the discovery layer:

1. Finds all active neighborhoods via the Nostr discovery channel.
2. Asks each one its current size and whether it's accepting joiners.
3. Joins the neighborhood with the most space (or creates a new one if all are at 6).

In v0.1 this routing is simple and centralized in the client logic. In v0.2 it becomes more sophisticated: prefer neighborhoods with similar latency, prefer neighborhoods where the player has a friend, etc.

### Neighborhood lifecycle

- A neighborhood is *created* when the first player arrives at today's grid and finds no existing neighborhoods.
- A neighborhood is *grown* by accepting joiners up to 6.
- A neighborhood is *split* when it would exceed 6 — the new player creates a sibling instead.
- A neighborhood is *merged* with a sibling when it shrinks below 3 and a sibling has space.
- A neighborhood is *destroyed* when its last peer leaves. (Its persistent state — the cells in its region — is gossiped to a sibling neighborhood before destruction so the grid does not lose state.)

## Connection phase

The time between `npx grid` and "you are playing" has specific behavior that prevents state divergence:

1. The lockstep starts **paused**. No simulation ticks run. The renderer shows "connecting to room..." while Trystero negotiates the WebRTC handshake via Nostr relays (~2–8 seconds depending on relay latency).
2. **If a peer connects** and the HELLO exchange determines seniority:
   - The **senior** (earliest `joined_at`) unpauses immediately and starts ticking. Their state is canonical.
   - The **junior** stays paused, sends `STATE_REQUEST`, receives `STATE_RESPONSE` (a base64-encoded canonical snapshot), installs it, and unpauses. Both peers are now at the same tick with identical state.
3. **If no peer connects within 8 seconds** (the seed timeout), the player is the seed of a new neighborhood. The lockstep unpauses and they tick alone. Late joiners sync to them via the same STATE_REQUEST/RESPONSE flow.

This phase replaces the future intro animation (Stage 4). The intro animation will be calibrated to overlap exactly with the WebRTC handshake so the ritual IS the connection wait.

## Cold-start handling

A first-time player on day one with nobody else online sees an empty discovery channel. GRID handles this by:

1. The client connects to Nostr relays and looks for active neighborhoods.
2. Finding none, it creates the first neighborhood and waits (the "connecting..." screen).
3. After the seed timeout (~8s), the lockstep unpauses and the grid is rendered as empty but functional. The player can drive their cycle alone for as long as they want.
4. When a second player arrives, the discovery layer connects them and the junior installs the senior's state via STATE_REQUEST/STATE_RESPONSE.

Empty grids are not failure states. They are how the world starts each day in low-population periods.

## Failure modes

Honest list of what can go wrong:

- **All Nostr relays unreachable.** Player cannot discover peers. GRID prints an error and exits with a hint to try again or supply `--relay`. Mitigation: hardcoded list of 5 relays; failure requires all 5 to be down simultaneously.
- **Peers connect to different relay subsets and never see each other.** If Trystero picks random relays from its default pool, two peers can end up on disjoint subsets. Mitigation: v0.1 pins an explicit small relay list so ALL peers use the SAME relays. The `--relay` override lets players route around a bad relay.
- **Restrictive NAT prevents WebRTC connection.** Two peers see each other via Nostr but cannot establish a direct data channel. v0.1: the connection times out and the player joins a different neighborhood (or creates their own). v0.2: optional TURN relay fallback.
- **Lockstep stalls because one peer is temporarily slow.** The lockstep waits up to 150ms (`INPUT_TIMEOUT_MS`) past the tick deadline, then defaults the missing peer's input to `''` (straight, no turn). After 3 consecutive timeouts for the same peer (`CONSECUTIVE_TIMEOUT_THRESHOLD`), that peer is **auto-defaulted with zero wait** on all subsequent ticks — the game runs at full 10 tps for everyone else while the slow peer's cycle drifts straight on autopilot. This is softer than immediate eviction and handles transient slowness gracefully.
- **A peer's process freezes (Windows Quick Edit, laptop sleep, debugger).** If the wall-clock jumps by more than 2 seconds (`FREEZE_THRESHOLD_MS`) between two `runOnce` calls, the client detects a freeze, pauses its own lockstep, and sends `STATE_REQUEST` to the most-senior peer. The senior responds with a fresh snapshot and the frozen peer re-syncs — identical to the joiner flow. The non-frozen peers were running at full speed the entire time (via auto-default) so no one was impacted.
- **State hash mismatch.** A peer's state hash diverges from the others. That peer is evicted and asked to re-sync from a known-good peer. If it cannot, it is dropped.
- **All peers in a neighborhood disconnect simultaneously.** The neighborhood ceases to exist. Its persistent state is lost unless it had time to gossip to a sibling. v0.2 mitigates this with periodic gossip checkpoints.

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
- Use a single Nostr discovery topic (`grid:YYYY-MM-DD`) for all sibling rooms. Sibling rooms gossip via this topic.
- Persistent state sync (when a player joins mid-day) should be requested via a `STATE_REQUEST` message and answered by the most-senior peer in the room. See [`../protocol/wire-protocol.md`](../protocol/wire-protocol.md).
- **Pinned Nostr relays for v0.1** (passed explicitly to Trystero's `relayUrls` config):
  ```
  wss://nos.lol
  wss://relay.primal.net
  wss://relay.notoshi.win
  wss://relay.mostr.pub
  wss://relay.nostr.net
  ```
  Each relay must: (1) accept WebSocket connections, (2) accept Trystero's custom event kind 22766 without blocking, (3) not require paid signup or web-of-trust policy, (4) not aggressively rate-limit event publishing. Relays that block custom kinds (e.g. `purplepag.es`), require signup (e.g. `nostr.wine`), enforce web-of-trust (e.g. `offchain.pub`), or rate-limit signaling (e.g. `relay.damus.io` under load) will silently break peer discovery or cause event-loop stalls that degrade lockstep timing.
  All peers MUST use the same relay list, otherwise they may end up on disjoint subsets and never discover each other. The `--relay` CLI flag overrides this list for players who want to use community-run or self-hosted relays.
- Hardcode Google's STUN servers. Allow override with `--stun`.
- Do **not** ship a TURN server in v0.1. If players hit NAT issues, document the workaround (use a different network) and add a TURN fallback in v0.2.
- **Node.js WebRTC polyfill**: Trystero requires `RTCPeerConnection`, which Node 22 does not provide natively. The `node-datachannel` package supplies a standards-compliant polyfill, passed to Trystero via the `rtcPolyfill` option. Single import site: `src/net/room.ts`.
