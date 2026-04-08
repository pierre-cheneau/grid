# Design pillars

These are the load-bearing principles. Every design decision in GRID should be checked against this list. If a proposed feature contradicts a pillar, the pillar wins.

## 1. Place, not game

GRID is a place that contains a game, not a game with a setting. The world exists when you are not in it. The grid has memory, history, weather, and rhythm. Sessions are visits, not matches.

**Implication:** anything that frames GRID as a sequence of disposable matches (lobbies, "play again?" screens, match-end disconnects) is wrong. Anything that makes the world feel continuous (persistent state, accumulated cells, daily rhythms, named regulars) is right.

## 2. Two valid modes, one world — and daemon authorship is not a coder privilege

Pilot mode (reflex, ninety seconds, no setup) and daemon mode (a program that drives a cycle for hours or days) are equally legitimate. The pilot is not a tutorial for the daemon. The daemon is not a "pro" version. Both inhabit the same grid, both contribute to the same culture, both are first-class citizens.

Daemon mode itself has **two equally valid authorship paths**: hand-written (a coder writes the program) and **forged from an English description** (a non-coder runs `npx grid forge "..."` and an LLM writes the daemon for them, sandbox-tests it, and deploys it). Both paths produce daemons that are indistinguishable to the grid and to other players. Authorship-by-description is real authorship; the gatekeeping that "real" daemons must be hand-coded is rejected.

**Implication:** the wire protocol must be designed text-first and daemon-ready from line one, even though v0.1 ships pilot-only. The LLM-facing reference (`AGENTS.md`) ships in v0.1 even though `forge` is v0.2, so AI coding assistants used by daemon authors today already have the context they need. Recognition systems (crowns, replays, archive) must surface heroic moments from pilots, hand-coded daemons, and forged daemons equally — *and must not distinguish them in the recap*. A non-coder who plays for a year must feel like a citizen with their own daemon in the grid, not a tourist.

## 3. No server, no operator, no kill switch

GRID has no central infrastructure. No matchmaking server, no game server, no leaderboard server. Networking is WebRTC mesh between peers; signaling rides on public Nostr relays; the archive is a public git repository. The original authors cannot shut GRID down, monetize it, or change the rules without players opting in.

**Implication:** any design that requires central state, central authority, or central trust is rejected on principle. Anti-cheat must be local consensus among peers, not a server check. Identity must be derived, not granted. The archive must be replicable by anyone.

## 4. Identity is derived, never granted

Players do not create accounts. They do not pick names. Their identity is derived from their real machine: `${USER}@${HOSTNAME}`, and a trail color hashed from a stable machine identifier. The game *recognizes* you because you arrived on a real computer, and that is enough.

**Implication:** no signup, no login, no account recovery, no profile pages, no cosmetics shop. Identity is something you bring with you, not something the game hands out.

## 5. Ritual over convenience

GRID has a digitization intro that plays every time you launch it. It is short (one or two seconds), beautiful, and not skippable. The intro is the threshold between the outside world and the grid. The friction is the value, not the cost.

**Implication:** the intro animation runs *during* the WebRTC handshake, so the ritual is also the loading bar. Anything that asks "skip intro?" is rejected. Anything that makes the threshold feel meaningful (subtle variation, machine-derived content) is encouraged.

## 6. The four retention features

GRID is designed to survive the hype loop. The four structural features that produce decade-long retention in geek games are non-negotiable design constraints:

1. **Unreachable skill ceiling.** The skill in pilot mode is real-time spatial reading of an emergent grid. The skill in daemon mode is programming itself. Neither has a top.
2. **Story-generating emergence.** The grid is a small ecology — decay, structures, cycles, daemons, the daily reset — and small ecologies produce stories nobody planned. Every session must produce a tellable moment.
3. **Self-expression surface.** Two equally skilled players must play *recognizably differently*. Pilots have style. Daemons have authorship. Both are visible to other players.
4. **Culture-friendly shape.** Shared situations recur across players' experiences (the daily grid, the archive, named players, recurring crown winners). Players have something in common to talk about.

A proposed feature that fails any of these four is suspect. A proposed feature that strengthens all four is golden.

## 7. The doorway is ten seconds

A first-time player must be playing within ten seconds of typing `npx grid`. No tutorial, no menu, no name prompt, no choice to make. The intro plays, they arrive, they press an arrow key, they understand. Anything that adds friction to the doorway is removed. Depth is hidden behind discovery, not gated behind onboarding.

## 8. Decay is a physics constant, not a goal

The grid is constantly decaying. Cells have a half-life. Structures need maintenance. This is not a win condition — it is a *condition* that makes the goals interesting. It prevents clutter, rewards active play, and creates the natural tension between creation and destruction.

**Implication:** decay calibration is the secret hard problem of GRID and will require iterative tuning. There is no theoretical answer.

## 9. The grid scales with population, not against it

The grid is sized to its current population. Empty grids stay alive (small and intimate); peak hours are sprawling and chaotic. Players are routed into local neighborhoods of ~6 active programs each (the WebRTC mesh limit). As more players join, more neighborhoods spawn. As some leave, neighborhoods merge. The grid is *always* sized to feel full.

**Implication:** there is no minimum player count to "fill the lobby." There is no maximum global player count. Both extremes work.

## 10. Daemons fit in four kilobytes

GRID enforces a hard cap on daemon source size: **4,096 bytes (4 KiB)**. Every daemon — hand-coded or forged — must fit. Files larger than 4 KiB are rejected at deploy time. The cap applies to the source file as written: UTF-8, LF line endings, including comments and shebang.

This is not an arbitrary restriction. It is a deliberate creative constraint in the lineage of haiku, sonnet form, code golf, and the demoscene 4K intro. The cap exists to:

- **Make compactness a craft.** A bounded program forces authors to make real choices about what their daemon does and what it doesn't. Without the cap, daemons drift toward "do everything," which is the boring kind of complexity. With the cap, daemons become *focused*, and focus is what produces recognizable style.
- **Keep the skill ceiling honest.** Without a limit, the "best" daemon is whoever has the most engineering hours and the most patience. With a limit, the best daemon is whoever thinks most clearly within the constraint. This is the chess principle: small fixed rules, infinite depth.
- **Make the Minimalist crown meaningful.** The 4 KiB cap is deliberately *higher* than what good daemons need. Good daemons fit in 1–2 KiB; the cap is the upper bound, not the target. This headroom is what makes voluntary smallness an achievement worth celebrating, the way 4K intros celebrate going far below 4K.
- **Protect the in-process worker model.** A bounded source size implicitly bounds startup time, memory footprint, and tick latency, which lets the runtime enforce resource limits cleanly without surprising the daemon author.
- **Connect GRID to a 30-year cultural lineage.** "4K intro" is a famous demoscene category. Calling GRID daemons "4K daemons" attaches the game to the demoscene, code-golf, IOCCC, and Forth communities — audiences that will instantly understand what GRID is and why it matters.

**Corollary:** the **Minimalist crown** (see [`../design/goals.md`](../design/goals.md)) recognizes the smallest daemon that placed in the top three of any other crown on the same day. The cap is the rule; the crown is the reward for going far below it.

**Implication:** the cap is enforced structurally at deploy time, not as a guideline. Hand-coders cannot bypass it by editing files manually. Forge LLMs are instructed about the cap so their first generations land under it. The size tiebreaker on the other four daemon crowns (smaller daemon wins ties) makes the cap felt softly on every leaderboard.

**The escape valve:** a daemon can read external state from `~/.grid/daemons/mybot.state` to consult precomputed data (opening books, learned patterns, lookup tables) as long as the *daemon code itself* is under 4 KiB. This preserves the constraint while not making complex strategies impossible — sophisticated authors keep their data in a separate file and write the lookup logic in 4 KiB.

## 11. Memory is the moat

GRID's competitive advantage against any future copycat is *the archive*. Every day's grid, every day's crowns, every day's notable moments are saved into a permanent public record. After a year, GRID has a year of history; a copycat starting fresh has none. Players reference the archive in conversation. The archive is the cultural infrastructure that keeps GRID irreplaceable.

**Implication:** the archive is a v0.2 feature but the *protocol* for it must be designed in v0.1 so no data is lost between launch and the archive going live.
