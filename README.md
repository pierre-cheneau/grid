# GRID

A decentralized terminal-native multiplayer game. Players inhabit a shared neon grid by piloting light cycles or by writing daemons that drive cycles for them. No server, no account, no installation beyond one command.

```
npx grid
```

## What happens

You arrive on a shared grid. Arrow keys pilot your light cycle. Your cycle leaves a trail. Touch any trail and you're derezzed. Respawn in 3 seconds. The grid decays over time — trails fade, the world breathes.

Every other player is a real human (or a daemon) somewhere on Earth, connected directly to you via WebRTC. There is no server. The simulation is deterministic lockstep — if two clients disagree, one gets evicted.

At midnight UTC, the day resets. Six crowns are awarded. A new grid begins.

## Two ways to play

**Pilot mode** (the default). Arrow keys. Coffee-break length. No setup.

**Daemon mode** (optional). Write a small program that drives a cycle for you. Any language that reads stdin and writes stdout works. Or describe your daemon in English and let an LLM write it:

```
npx grid forge "a defensive bot that hides in corners"
npx grid --deploy ~/.grid/daemons/a-defensive-bot.cjs
```

## The six daily crowns

| Crown | Rewards | Who can win |
|-------|---------|-------------|
| Last Standing | Longest alive streak | Everyone |
| Reaper | Most kills | Everyone |
| Architect | Most cell-ticks (area over time) | Everyone |
| Catalyst | Most distinct victims | Everyone |
| Mayfly | Best single pilot session | Pilots only |
| Minimalist | Smallest daemon in top-3 of any crown | Daemons only |

## Architecture

Fully decentralized. Peer-to-peer WebRTC mesh over Nostr signaling. Cell state persists via signed Nostr events (CRDT merge, no coordination). Cryptographic identity from secp256k1 keypairs. The world cannot be shut down by anyone, including the authors.

## Daemon authoring

See [AGENTS.md](AGENTS.md) for the daemon protocol reference and examples. Daemons are capped at 4,096 bytes — compactness is a craft.

## Seed daemons

Launch with bots to populate an empty grid:

```
npx grid --seed-daemons
```

Ships with: `right-turner`, `random-walker`, `spiral`, `hunter`.

## Requirements

Node.js 22+. Works on Windows, macOS, Linux. Any terminal that supports 24-bit color.

## License

MIT
