# Gameplay

This document describes how a session of GRID actually plays — the mechanics of the cycle, the two modes of inhabitation, and the moment-to-moment loop. For the higher-level *why*, see [`concept/vision.md`](../concept/vision.md). For goals and win conditions, see [`goals.md`](goals.md).

## The cycle, the verb of v0.1

A **cycle** is a single bright cell on the grid that moves forward one cell every tick. It cannot stop. It can turn left or right at any tick. Behind it, it leaves a **trail** of cells in its color. Trails are walls: a cycle that enters a trail cell (its own or anyone else's) is **derezzed** (destroyed).

This is the classic Tron light-cycle ruleset, intentionally unchanged. It is the simplest possible verb that fits a coffee-break loop, is instantly understandable without explanation, and looks correct in a terminal renderer. It is also a verb with a known shallow skill ceiling, which is fine because the *world* provides the depth, not the verb.

### Cycle physics

- **Tick rate:** 10 ticks per second (configurable; tuned during balancing).
- **Movement:** one cell per tick in the current direction.
- **Turning:** left or right by 90°. Turns take effect on the next tick. Multiple turn inputs in the same tick are coalesced — only the most recent one counts.
- **Collision:** a cycle that enters any non-empty cell on the same tick as it moves derezzes. The cell types that derez a cycle: any trail cell, any wall cell, any other cycle's body cell.
- **Head-on collisions:** if two cycles try to enter the same cell on the same tick, both derez. This is intentional and produces dramatic ties.
- **Edge of the grid:** the grid is finite. Walking off the edge derezzes you. (See [`design/goals.md`](goals.md) on how the grid expands and contracts with population.)

### Trail mechanics

- **Persistence:** when a cycle is derezzed, its trail does **not** immediately disappear. Trails decay over time according to the grid's decay physics — a trail cell has a half-life measured in seconds, configurable per arena. This is what makes the grid an accumulating place rather than a series of disposable matches.
- **Color:** each cycle's trail is the color of its owner, derived from a hash of `${USER}@${HOSTNAME}` (see [`identity-and-aesthetic.md`](identity-and-aesthetic.md)).
- **Ownership:** trail cells remember who placed them. This is important for the crown system — kills, structures, and contributions all credit the original owner.

### Death and respawn

When a cycle is derezzed:

1. The death is announced to the local neighborhood.
2. Both the killer (if any) and the deceased are credited in the day's records.
3. After a 3-second countdown, the player respawns at a randomly chosen safe cell in their current neighborhood with a fresh cycle.
4. The dead cycle's trail remains on the grid and decays normally.

There is no respawn limit. There is no game-over screen. The session ends when the player closes the terminal, not when they die.

## Pilot mode

The default and the doorway. A pilot is a human pressing arrow keys.

### Controls

- **Arrow keys** or **WASD** or **`hjkl`** — turn the cycle. Up/W/K is a no-op (you cannot reverse) but accepted as a valid input. Down/S/J is also a no-op. Only Left and Right turn the cycle.
- **`q`** or **Ctrl-C** — exit GRID gracefully (writes the epitaph, dissolves your cycle, leaves the grid).
- **Space** — no-op in v0.1. Reserved for the structure-placement verb in v0.2.
- **Tab** — toggle spectator overlay (see "watching" below).

That is the entire control surface. No menus. No options screen.

### A pilot's session

1. They type `npx grid`.
2. The intro animation plays while the WebRTC connection establishes (1–2 seconds).
3. They arrive at a random safe cell in today's grid, in a neighborhood with up to 5 other active programs.
4. They start moving. They turn. They die. They respawn. They turn again.
5. After ~90 seconds (or 3, or 30 minutes — there is no enforced session length), they press `q` and the cycle dissolves into characters that scroll up out of the terminal. A two-line ANSI epitaph remains in their scrollback: their kills, their longest run, their day's contribution score.
6. They go back to work.

A pilot does not need to know that daemons exist, that the grid has a daily reset, that there is an archive, that there are crowns. None of this is in the UI. They can play happily for a year and only ever know "I drive a cycle on a glowing grid against other people."

### Spectator mode (a pilot can become one mid-session)

Pressing `Tab` toggles a spectator overlay: the current cycle is paused (technically, it continues moving in the simulation, but the player relinquishes input control), the camera detaches, and the player can pan around the grid to watch what's happening elsewhere. Pressing `Tab` again resumes piloting (if the cycle is still alive) or queues a respawn.

Spectating is *also* the tutorial. A new player who arrives in a busy neighborhood and watches for thirty seconds before pressing an arrow key has learned the rules without reading anything.

## Daemon mode

The optional, discoverable, deep mode. A daemon is a small program that drives a cycle the way a pilot does, but algorithmically and continuously. There are **two equally legitimate ways** to author one: hand-written (for coders) and forged from an English description (for everyone else). Both produce daemons that are indistinguishable to the grid.

### How a daemon connects (both authorship paths)

A daemon does not run *inside* the GRID client. The GRID client launches it as a subprocess. The contract:

- The user runs `npx grid --deploy ./mybot.py` (or `./mybot`, `./mybot.exe`, `./mybot.js`, etc.).
- The GRID client launches `mybot.py` as a subprocess and pipes a documented text stream to its stdin.
- The subprocess writes movement commands to its stdout.
- The GRID client relays those commands to the grid as if they were keypresses.
- When the GRID client exits (or when the daemon process exits), the cycle leaves the grid.

The full text protocol is in [`../protocol/daemon-api.md`](../protocol/daemon-api.md). The LLM-facing practical reference is in [`../../AGENTS.md`](../../AGENTS.md). The point is that *any language* can drive a daemon — Python, Go, Rust, Bash with awk, Common Lisp, anything that can read a line from stdin and write a line to stdout.

### Path 1: hand-written daemon (coders)

A coder writes a daemon directly in their preferred language. The protocol is small enough to learn from a 25-line example. They iterate by editing code and re-deploying. Daemon code is shared on GitHub like speedrun routes; the community accumulates a library of public bots over time.

### Path 2: forged daemon (non-coders, via LLM)

A non-coder runs:

```
$ npx grid forge "a defensive bot that hides in corners and only fights when cornered"
```

The forge command bundles `AGENTS.md` and the user's description into a prompt, sends it to the user's configured LLM (BYOK — see [`forge.md`](forge.md)), receives a daemon script, sandbox-tests it for 60 seconds, and reports success or failure in plain English. On success, the user deploys it the same way as a hand-coded daemon:

```
$ npx grid --deploy ~/.grid/daemons/cornered.py
```

The non-coder never reads the script. They iterate by describing what should be different:

```
$ npx grid forge --refine cornered "make it more aggressive when its trail is short"
```

This is real daemon authorship, just at a different layer of the stack. A forged daemon carries its author's name and style and lives in the grid alongside hand-coded ones with no distinction in the recap. See [`forge.md`](forge.md) for the full design and rationale.

**Forge is a v0.2 feature.** v0.1 ships `AGENTS.md` (so AI coding assistants can already help daemon authors) but does not ship the `forge` command itself.

### A daemon's session

### A daemon's session (after authoring, regardless of path)

1. The author either writes the program by hand (path 1) or forges it from a description (path 2). Either way, they end up with an executable file under `~/.grid/daemons/` or wherever they prefer.
2. They run `npx grid --deploy ./mybot.py`.
3. The intro animation plays (still, every time — the ritual is for daemons too).
4. The daemon arrives in today's grid. It is named `bot:mybot@${USER}@${HOSTNAME}` so other players know who wrote it.
5. The daemon plays continuously. Hours, days, until the daemon process is killed, the laptop is closed, or the GRID client exits.
6. While the daemon plays, the GRID client shows a live view of the grid in spectator mode. The author can `Ctrl-C` and watch passively, or close the terminal entirely (leaving the daemon process running in the background, depending on platform).

A daemon that wants to run continuously should be hosted on a small VPS by its author. GRID does not host anything. This is correct: it makes the bot ecology depend on real human investment, which is a feature.

### Pilots vs daemons in the same world

A pilot and a daemon are mechanically indistinguishable from the grid's point of view. Both produce a stream of "turn left / turn right / nothing" inputs at each tick. The grid does not know which is which. They share neighborhoods, kill each other freely, and are subject to the same physics.

Some implications:

- A pilot can derez a famous daemon. This is a story they will tell.
- A daemon can derez a pilot. This is normal and not griefing — daemons are part of the world.
- The crown system credits both equally (see [`goals.md`](goals.md)).
- A neighborhood with 3 pilots and 3 daemons is normal and indistinguishable from a neighborhood with 6 pilots, except that the daemons may play strangely and the pilots may have nicknames for them.

## Moment-to-moment loop

A typical pilot session, narrated:

```
$ npx grid
[2s digitization animation, your name falling into the grid]

You are corne@thinkpad. You arrive in a neighborhood with five other programs.
A bright orange cycle is laying a long arc in the southwest corner — that's
bot:nightcrawler@marie@thinkpad. You see the trails of three other dead cycles
slowly fading into the grid floor, decaying.

You press Right. Your cycle turns. You almost clip a wall left over from a
fight five minutes ago. You curse. You turn Right again. You try to corner
nightcrawler. nightcrawler turns at the last second and you derez on its trail.

3... 2... 1... You respawn at a fresh cell. nightcrawler is gone — it derezzed
on its own trail trying to corner you. Two other pilots are now fighting in
the center. You join the fight.

90 seconds later, you press q.

  ── corne@thinkpad ──────────────────────────────
  visited the grid for 1m 34s
  4 derezzes, 6 deaths
  longest run: 18 seconds
  day contribution: 0.4 (rank #23 of 87 today)
  see today's grid: npx grid recap
  ────────────────────────────────────────────────

$
```

That is what GRID is, day to day. The cycle physics are simple. The grid is the depth.
