# Wire protocol

The peer-to-peer message format used between GRID clients in a neighborhood. This is the contract that lockstep simulation, joiner sync, and anti-cheat all bind to. It is designed to be:

- **Text-based** (newline-delimited JSON), so it is debuggable, logsafe, and trivial to reimplement in another language.
- **Tick-aligned**, so messages can be processed in deterministic order.
- **Versioned**, so future protocol changes do not break old clients.
- **Daemon-ready**, so the same primitives can carry both pilot inputs and daemon commands.

## Transport

Messages are sent over **WebRTC data channels in unreliable-unordered mode**. Each message is a single line of UTF-8 JSON terminated by `\n`. There is no length prefix; the newline is the framing.

Some message types are *idempotent and safe to drop* (state hashes, gossip). Others are *critical* and use a small reliable channel (joiner sync, peer eviction votes). The protocol distinguishes by message type.

## Message envelope

Every message has a common envelope:

```json
{
  "v": 1,
  "t": "INPUT",
  "from": "corne@thinkpad",
  "tick": 1234,
  "...": "type-specific fields"
}
```

- `v` — protocol version. Currently `1`. Clients reject messages with unknown versions.
- `t` — message type. One of the types below.
- `from` — sender identity (`${USER}@${HOSTNAME}`, exactly as displayed in the recap).
- `tick` — the simulation tick this message refers to. Required for INPUT and STATE_HASH; optional for control messages.

## Message types

### `HELLO` — peer introduction

Sent once when a peer joins a neighborhood, to all other peers.

```json
{
  "v": 1,
  "t": "HELLO",
  "from": "corne@thinkpad",
  "color": [0, 255, 200],
  "kind": "pilot",
  "client": "grid/0.1.0",
  "joined_at": 1234567890
}
```

- `color` — the peer's hashed RGB color, sent for display only. Other peers verify it matches the hash of `from`.
- `kind` — `"pilot"` or `"daemon"`. Daemons announce themselves; pilots are pilots. The grid does not change behavior based on this, but the recap and HUD do.
- `client` — client name and version, for debugging.
- `joined_at` — wall-clock unix time at join (used for "most-senior peer" tiebreakers in joiner sync).

### `INPUT` — per-tick player input

The most common message. Sent every tick by every peer (even if there is no input — an empty `INPUT` is still required to advance the lockstep).

```json
{
  "v": 1,
  "t": "INPUT",
  "from": "corne@thinkpad",
  "tick": 1234,
  "i": "L"
}
```

- `i` — input code. One of:
  - `""` (empty string) — no input this tick. Cycle continues straight.
  - `"L"` — turn left.
  - `"R"` — turn right.
  - `"X"` — leave the grid (graceful exit).

INPUT messages are sent in unreliable mode. If one is dropped, the receiving peer waits for a short timeout (~150ms past the tick deadline), then assumes the missing input is `""` and proceeds. The slow peer is flagged; if it consistently misses inputs, it is evicted.

### `STATE_HASH` — anti-cheat checksum

Sent every 30 ticks (every 3 seconds at 10 ticks/sec) by every peer.

```json
{
  "v": 1,
  "t": "STATE_HASH",
  "from": "corne@thinkpad",
  "tick": 1230,
  "h": "a3f8c92b7e1d4f06"
}
```

- `tick` — the tick whose state is being hashed. Always a multiple of 30.
- `h` — the truncated SHA-256 of the canonical serialization of the state at that tick (see [`../architecture/determinism.md`](../architecture/determinism.md)).

Peers compare hashes for the same `tick`. If a peer's hash differs from the majority, that peer is evicted by `EVICT` vote.

### `EVICT` — peer eviction vote

Sent when a peer detects another peer is desynced or unresponsive.

```json
{
  "v": 1,
  "t": "EVICT",
  "from": "corne@thinkpad",
  "target": "marie@archbox",
  "reason": "hash_mismatch",
  "tick": 1230
}
```

- `target` — the peer being voted against.
- `reason` — `"hash_mismatch"`, `"timeout"`, or `"disconnect"`.

When a majority of remaining peers (more than half, excluding the target) have voted EVICT against the same target, the target is removed from the neighborhood. The target's last-known cycle is derezzed in the simulation. The target is sent a `KICKED` message and disconnects.

### `STATE_REQUEST` — joiner asks for current state

Sent by a peer that has just joined a neighborhood and needs to sync.

```json
{
  "v": 1,
  "t": "STATE_REQUEST",
  "from": "newcomer@laptop"
}
```

The most-senior peer (longest `joined_at`) responds with `STATE_RESPONSE`.

### `STATE_RESPONSE` — full state snapshot

```json
{
  "v": 1,
  "t": "STATE_RESPONSE",
  "from": "corne@thinkpad",
  "to": "newcomer@laptop",
  "tick": 1234,
  "state_b64": "<base64 of canonicalBytes(state)>"
}
```

- `state_b64` is the base64 encoding of the canonical byte serialization defined in [`../architecture/determinism.md`](../architecture/determinism.md). This guarantees that the joiner installs a bit-identical state — JSON would lose information for the u64 RNG state and Map iteration order.
- The joiner installs the decoded state and resumes lockstep from `tick + 1`.
- For v0.1, full state is sent verbatim. For larger grids in v0.2+, an incremental sync (seed + input log) may replace this.

### `GOSSIP` — cross-neighborhood summary

Sent to a separate Nostr topic (not the WebRTC mesh) for inter-neighborhood communication.

```json
{
  "v": 1,
  "t": "GOSSIP",
  "from": "corne@thinkpad",
  "neighborhood": "grid:2026-04-07-b",
  "tick": 12345,
  "summary": {
    "players": 5,
    "kills_today": [ ["marie@archbox", 12], ["corne@thinkpad", 8] ],
    "longest_run": ["bot:nightcrawler@marie@archbox", 8400],
    "total_cells": 247
  }
}
```

GOSSIP messages are how the global recap is computed at midnight. Each neighborhood publishes its local summary; the merger combines them.

### `RECAP` — end of day publication

Sent at midnight UTC to the recap Nostr topic by every peer that has a complete view of the day.

```json
{
  "v": 1,
  "t": "RECAP",
  "from": "corne@thinkpad",
  "day": "2026-04-07",
  "neighborhoods_seen": ["grid:2026-04-07", "grid:2026-04-07-b"],
  "crowns": {
    "last_standing": { "name": "bot:nightcrawler@marie@archbox", "duration_seconds": 64800 },
    "reaper": { "name": "corne@thinkpad", "kills": 47 },
    "architect": { "name": "bot:builder@dev@archbox", "cell_tick_area": 184500 },
    "catalyst": { "name": "marie@archbox", "max_cascade": 8 },
    "mayfly": { "name": "stranger@m1pro", "session_score": 28.4 }
  }
}
```

Multiple peers may publish independent RECAPs. They are merged deterministically by the archive writer, and the merged version is committed.

### `KICKED` — eviction notification

Sent to a peer that has just been evicted, so it knows to disconnect cleanly.

```json
{
  "v": 1,
  "t": "KICKED",
  "from": "corne@thinkpad",
  "to": "marie@archbox",
  "reason": "hash_mismatch"
}
```

### `BYE` — graceful disconnect

```json
{
  "v": 1,
  "t": "BYE",
  "from": "corne@thinkpad"
}
```

The peer is leaving cleanly. Other peers immediately remove it from the neighborhood and derez its cycle.

## Nostr persistence events

In addition to the WebRTC wire protocol, GRID publishes persistence events to Nostr relays. These are NOT peer-to-peer messages — they are public events for state recovery and integrity verification.

### `grid:world-config` — daily world dimensions

Published at midnight UTC by every peer online at the reset. Contains the next day's world dimensions.

```
Kind: 22768
Tags: [["d", "grid:2026-04-09"], ["w", "120"], ["h", "60"], ["peak", "25"]]
```

- `d` — unique identifier (NIP-33 replaceable event by day).
- `w`, `h` — world width and height in cells.
- `peak` — yesterday's peak player count (used to compute the dimensions).

### `grid:cells` — compressed cell snapshot

Published every 60 seconds during active play and on graceful shutdown.

```
Kind: 22769
Tags: [["d", "grid:2026-04-09:cells"], ["tick", "540000"], ["count", "3200"]]
Content: <base64 of compressed binary cell array>
```

- `tick` — the simulation tick at which the snapshot was taken.
- `count` — number of cells in the snapshot.
- Content is a compact binary format (14 bytes/cell: x u16, y u16, createdAtTick u32, colorSeed u32, type u8, ownerHash u8), compressed with a Node.js built-in algorithm.

### `grid:chain` — hash chain attestation

Published every 300 ticks (30 seconds) per room. Forms an append-only hash chain for integrity verification.

```
Kind: 22770
Tags: [
  ["d", "grid:2026-04-09"],
  ["tick", "600"],
  ["sh", "a3f8c92b7e1d4f06"],
  ["ch", "b4e9..."],
  ["prev", "a1c3..."],
  ["peers", "3"]
]
```

- `sh` — stateHash (truncated SHA-256, same as peer-to-peer STATE_HASH).
- `ch` — chainHash = SHA256(prevChainHash + stateHash + tick).
- `prev` — previous chainHash (links the chain).
- `peers` — number of peers in the room at this tick (consensus weight).

Multiple independent peers publishing the same `ch` for the same `tick` constitutes consensus.

## Message ordering and delivery guarantees

| Type | Channel | Reliable? | Ordered? |
|---|---|---|---|
| HELLO | WebRTC | yes | yes |
| INPUT | WebRTC | no | no (tick-tagged) |
| STATE_HASH | WebRTC | no | no (tick-tagged) |
| EVICT | WebRTC | yes | yes |
| STATE_REQUEST | WebRTC | yes | yes |
| STATE_RESPONSE | WebRTC | yes | yes |
| GOSSIP | Nostr | best-effort | best-effort |
| RECAP | Nostr | best-effort | best-effort |
| KICKED | WebRTC | yes | yes |
| BYE | WebRTC | yes | yes |
| grid:world-config | Nostr | best-effort | best-effort |
| grid:cells | Nostr | best-effort | best-effort |
| grid:chain | Nostr | best-effort | best-effort |

WebRTC data channels can be configured per-channel; v0.1 uses one unreliable-unordered channel for INPUT and STATE_HASH (the high-volume tick-aligned messages), and one reliable-ordered channel for everything else.

## Versioning

The `v` field allows the protocol to evolve. v0.1 ships `v=1`. Future versions may add fields, deprecate fields, or introduce new message types.

Backward compatibility rule: a client that sees a `v` greater than its own MUST disconnect from that peer with a `BYE` and a console warning telling the user to upgrade. A client that sees a `v` less than its own SHOULD attempt to interoperate by ignoring unknown fields, or disconnect if structural changes prevent it.

This is intentionally simple. There is no negotiation; clients of mismatched protocol versions just refuse to talk to each other. Players see "your client is out of date, run `npx grid@latest`" and the problem solves itself.

## Implementation notes for v0.1

- Use `JSON.stringify` and `JSON.parse` directly for messages. No custom serialization.
- One reliable channel and one unreliable channel per peer. Negotiate during the WebRTC offer/answer.
- Tick-aligned messages buffer up to ~3 ticks ahead before being applied; older messages are discarded.
- The full message log of a session can be optionally written to `~/.grid/log/YYYY-MM-DD.ndjson` for debugging. Off by default. Useful for diagnosing desyncs.
- All message handlers must be defensive against malformed input. A peer that sends garbage is evicted, not crashed.
