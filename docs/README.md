# GRID — documentation

This folder contains the full concept, design, and technical specs for **GRID**: a small, decentralized, terminal-native game-world that geeks visit on their coffee breaks and sometimes never leave.

> GRID is not a game you play. It is a place you visit.

## Reading order

If you're new, read in this order:

1. [`concept/vision.md`](concept/vision.md) — what GRID is, in one page
2. [`concept/pillars.md`](concept/pillars.md) — the design principles everything else binds to
3. [`design/gameplay.md`](design/gameplay.md) — how a session actually plays
4. [`design/goals.md`](design/goals.md) — the four timescales, the crowns, decay
5. [`design/identity-and-aesthetic.md`](design/identity-and-aesthetic.md) — who you are, what it looks like
6. [`design/forge.md`](design/forge.md) — daemon authorship for non-coders, via LLM
7. [`architecture/overview.md`](architecture/overview.md) — the technical big picture
8. [`architecture/networking.md`](architecture/networking.md) — P2P, Trystero, Nostr, neighborhoods
9. [`architecture/determinism.md`](architecture/determinism.md) — lockstep simulation, anti-cheat
10. [`architecture/persistence.md`](architecture/persistence.md) — daily grid, midnight reset, archive
11. [`protocol/wire-protocol.md`](protocol/wire-protocol.md) — the peer-to-peer message format
12. [`protocol/daemon-api.md`](protocol/daemon-api.md) — how player programs talk to the game
13. [`roadmap.md`](roadmap.md) — v0.1 scope, build stages, known risks

For the implementation rules, see [`engineering/`](engineering/) — the rules that govern how GRID code is written. Start with [`engineering/README.md`](engineering/README.md) for the index. The root [`CLAUDE.md`](../CLAUDE.md) is the entry point AI coding agents read first.

Also at the project root: [`AGENTS.md`](../AGENTS.md) — the LLM-facing daemon authoring reference. Used directly by `npx grid forge` (v0.2) and by AI coding assistants helping daemon authors today. **Not** the engineering rules for working on GRID itself; see `CLAUDE.md` for that.

## One-paragraph pitch

You type `npx grid`. Your terminal goes fullscreen, your username and hostname dissolve into glowing characters and fall into a neon grid. You arrive in *today's grid*, a single shared world that resets at midnight. You drive a light cycle with the arrow keys for ninety seconds. You die. You respawn. You leave. Tomorrow you come back and the grid remembers you. Eventually you discover that other players have *programs* that live in the grid for hours or days, fighting alongside the pilots — some hand-coded, some written by an LLM from a single English sentence. Eventually you have one too. There is no server. No one operates GRID. No one can shut it down.
