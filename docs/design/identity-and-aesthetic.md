# Identity and aesthetic

This document covers two things that are technically separate but psychologically inseparable: **who you are in the grid** and **what the grid looks and feels like**. Both are load-bearing for the "place not game" pillar.

## Identity is derived, never granted

GRID has no accounts, no signup, no profiles, no usernames you pick. Your identity is derived from your real machine the moment you arrive, and that is the only identity the grid recognizes.

### What identity is made of

- **Display name:** `${USER}@${HOSTNAME}`. Examples: `corne@thinkpad`, `marie@archbox`, `dev@m1pro`. This is what other players see in the recap, in the local neighborhood roster, and in the kill notifications.
- **Trail color:** a 24-bit RGB color derived deterministically from a hash of a stable machine identifier (machine-id on Linux, IOPlatformUUID on macOS, MachineGuid on Windows) salted with the username. The hash is biased toward neon-bright colors (high saturation, high value) so trails are always vivid.
- **Daemon prefix:** when a daemon is deployed, its name is prefixed with `bot:` and includes the daemon script name. Example: `bot:nightcrawler@marie@archbox`. This makes daemon authorship visible at a glance.

Identity is generated *the first time the player runs `npx grid`* and cached in `~/.grid/identity.json` so the same machine produces the same color forever, even after reinstalls. The cache includes a **Nostr-compatible keypair** (Schnorr) used to sign grid state published to relays — this is the player's cryptographic identity, persistent across sessions. Deleting the cache generates a fresh identity (and a fresh keypair).

### Why this is the right model

- **No friction.** A new player has zero setup. They never see a signup form, never pick a name, never lose a password.
- **Real-world grounding.** Your name comes from your machine, not from a fantasy you invented. This is the strongest possible expression of the "I am a process inside the machine" fantasy: your *actual* process metadata is your in-game identity.
- **Recognizable across sessions.** Other players see `corne@thinkpad` consistently. Over weeks they learn the name. Over months they recognize the playstyle.
- **Decentralized by construction.** No server can grant or revoke identity, because identity is computed locally from facts the player's machine already knows.
- **Honest about uniqueness.** Two players with the same `user@hostname` *will* collide. This is rare, and when it happens, the collision is part of the world's texture. (A future version may append a 2-character hash suffix to disambiguate; v0.1 does not.)

### What identity is *not*

- It is **not** an account. There is no login.
- It is **not** transferable. If you switch machines, you are a new player. If you want to be the same player across machines, copy `~/.grid/identity.json`.
- It is **not** customizable. You cannot change your color or your name. The point is that they are *given*.
- It is **not** authenticated. A determined attacker can spoof any identity they want by editing the cache file. This is fine — there is nothing valuable to steal, and the lockstep cross-check (see [`architecture/determinism.md`](../architecture/determinism.md)) protects against gameplay cheating regardless of identity claims.

## Aesthetic: vector neon in a terminal

GRID looks like Tron. Specifically, GRID looks like the *vector graphics* of the original 1982 film: thin glowing lines on black, primary saturated colors, geometric clarity, no gradients, no textures. This is exactly the aesthetic that a terminal can render natively, and it is the reason GRID is a terminal game and not a browser game.

### Rendering primitives

GRID uses three categories of Unicode characters and one color model:

1. **Box-drawing characters** for the world boundary, walls, and structures:
   ```
   ─ │ ┌ ┐ └ ┘ ┼ ├ ┤ ┬ ┴
   ━ ┃ ┏ ┓ ┗ ┛ ╋ ┣ ┫ ┳ ┻
   ╱ ╲ ╳
   ```
   These render as crisp connected lines on any modern terminal. The world boundary is drawn with these characters when the player is near the edge — it is a physical wall in the world, not a UI decoration.

2. **Block characters** for the cycle heads and high-density features:
   ```
   █ ▀ ▄ ▌ ▐ ░ ▒ ▓
   ```
   The cycle head is `█` in the cycle's color. The trailing cell behind the head is `▓` (slightly dimmer) to give a sense of motion. Older trail cells fade through `▒` and `░` as they decay.

3. **Glyphs and punctuation** for HUD elements and rare features:
   ```
   ◆ ◇ ● ○ ▲ ▼ ★ ☆ ⌬ ⊕ ⊘ ✦
   ```
   Used sparingly. Reserved for special cells, structures, or HUD markers.

4. **24-bit ANSI color** (`\e[38;2;R;G;Bm`) for everything. Each cycle's color is its hashed RGB. The grid floor is a deep blue-black (`#0a0a1a`) with breathing dot characters (`.`). Walls and world boundaries are bright cyan (`#00ffff`). The intro animation uses Matrix green (`#00ff41`). Decaying cells fade their color toward black as they age.

### Layout and projection

The grid is rendered as a **flat top-down view**. The world grid is larger than the terminal — each player sees a **viewport** centered on their cycle, a window into the world. The world scrolls around the player as they move. Each grid cell is one terminal character.

There is no bordered rectangle framing the play area. The player's terminal IS the viewport. The world extends in every direction, filled with breathing dots on empty floor. The only frame is the **world boundary** — a physical cyan wall (`│ ─ ┌ ┐ └ ┘`) that appears when the player is near the edge. Beyond the world boundary is **void** (pure black, no dots). The edge is the edge of reality.

This means:
- In the middle of the world, the player sees grid floor in every direction. No borders visible. Immersive.
- Near the world edge, the cyan boundary wall appears on one side (or two sides at corners).
- The world boundary is a lethal wall — crashing into it is a derez.
- The camera clamps at world edges so the void is visible but the camera never shows "beyond."

The viewport size is the terminal dimensions minus one row (for the status line). The camera follows the local player's position.

A future v0.2 may add an optional **isometric tilt** mode where the grid is projected at a 30° angle and box-drawing characters are used to render the perspective lines. This looks more cinematic but is harder to play (perspective compresses depth perception). The tilt is *additive* — the gameplay is identical, only the renderer changes — so it can be added later without protocol or simulation changes.

A future v0.3+ may add a **3D ASCII cinematic mode** for screenshots and replays, using real perspective projection and depth-character mapping (`.:;-=+*#%@`). This is explicitly *not* the play view; it is a screenshot/replay flex.

### Why no real 3D, ever, in the play view

ASCII 3D looks gorgeous in screenshots and is harder to *play* than to look at. Character cells blur together at speed; players cannot read the game state in 50ms when the view is rasterized 3D ASCII. The 2D constraint isn't a limitation, it's a focusing function that protects gameplay from being eaten by graphics work. Multiple terminal-game projects have died on this rock. GRID will not.

### Color discipline

Colors in GRID carry meaning:

- **Cycle color** = identity (whose program is this).
- **Cyan** = walls and world boundary edges (immutable structure).
- **Dim blue-black with breathing dots** = empty grid floor (the world is alive).
- **Black** = void beyond the world boundary (the grid doesn't extend there).
- **Matrix green** (`#00ff41`) = the digitization animation, the threshold ritual.
- **White** = HUD text, system messages, names in the recap.
- **Magenta** = warnings, derez notifications, low-decay critical cells.

A new player should be able to read the grid by color alone within ten seconds. Adding a color is a design decision, not a stylistic one.

## The digitization intro

Every time the player types `npx grid`, the terminal performs a small ritual that takes ~1.5–2 seconds. This is the threshold between the outside world and the grid, and it is designed to be psychologically meaningful, not technically necessary.

### What the player sees

1. The terminal is cleared and switched to alternate-screen mode (so the previous shell history is preserved underneath).
2. A cursor prompt `>_` appears centered, blinking (~1.5s).
3. The player's `${USER}@${HOSTNAME}` types itself out in Matrix green, as if the grid is reading the player's machine identity.
4. A dramatic pause — the cursor blinks. Approximately 1 in 100 plays, a hidden message appears below the prompt (a quote from Tron, a haiku about programs). Players who notice will tell other players. Free culture.
5. The identity characters explode outward in a spinning tornado vortex, each character orbiting and expanding. The green shifts toward cyan as the tornado grows. As the characters spiral outward, the eye of the tornado opens, revealing the breathing dot grid beneath — the player is falling INTO the grid.
6. The tornado exits the screen. The full breathing dot grid is revealed. The player is inside.
7. The player's cycle materializes at center screen, shifting from green to its identity color.
8. Control transfers to the player. The first game frame renders seamlessly — there is no bordered rectangle to construct, just the infinite living grid floor surrounding the player's cycle.

Total elapsed time: ~12 seconds. **The animation duration is calibrated to overlap exactly with the WebRTC peer connection handshake and Nostr relay negotiation.** The ritual is also the loading bar. This is not a coincidence; it is the entire reason the design works.

### Why it must not be skippable

The first instinct of any developer is to add `--no-intro` or "press any key to skip." This must be resisted. Skippable rituals stop being rituals; the threshold loses its meaning the moment the player can step around it. Long-term retention research consistently shows that "skip intro" buttons measurably reduce engagement even when they improve short-term satisfaction.

The intro is short enough (~1.5s) that nobody *wants* to skip it. If players are asking for a skip button, the intro is too long, not too unskippable.

### Subtle variation

Pure repetition becomes wallpaper. The intro must vary subtly across plays to stay alive in the player's perception:

- The exact characters that fall vary by tick (deterministic from the current time).
- Approximately 1 in 100 plays, a hidden message scrolls past in the falling characters — a quote from Tron, a haiku about programs, a reference to the grid's history. Players who notice these will tell other players. This is free culture.
- The cycle's first position varies.
- The other cycles in the grid fade in at slightly different times each play.

None of this is gameplay-relevant. All of it is texture. Texture is what keeps a ritual alive past day 30.

## The exit epitaph

When the player presses `q` or Ctrl-C, GRID does not just disconnect. It performs a small reverse ritual:

1. The player's cycle dissolves into characters that scroll *up* out of the terminal.
2. The grid fades back to dim, then to the alternate-screen-mode buffer.
3. The terminal exits alternate-screen mode and the player's normal shell history reappears.
4. **A two-line ANSI epitaph is printed to the player's actual scrollback**, in their identity color:

   ```
   ── corne@thinkpad ──────────────────────────────
   visited the grid for 1m 34s · 4 derezzes · 6 deaths · longest run 18s
   ── day contribution 0.4 · rank #23 of 87 · npx grid recap ──────
   ```

5. The shell prompt returns.

The epitaph is the *only* trace GRID leaves on the player's machine outside `~/.grid/`. It lives in their shell scrollback. Their shell history *is* their match history. No database, no profile page, no server. This is the most decentralized possible record of a session, and it is also the most personal one.

### Why the epitaph matters

- **It closes the ritual.** A ritual without an exit feels broken. The player needs the world to acknowledge that they were here.
- **It seeds curiosity.** "Day contribution 0.4 · rank #23 of 87" is a tiny tease that makes the player want to know what those numbers mean and how to improve them.
- **It is shareable.** Players will screenshot epitaphs and share them in chats. This is free marketing that costs nothing to support.
- **It builds long-term identity.** Over weeks, the player accumulates a stack of epitaphs in their scrollback. Scrolling past them is a small reminder that they are a citizen of the grid.

## Summary

The aesthetic and identity systems work together to deliver one feeling: **you are a real program on a real machine, recognizable across visits, inhabiting a real shared world that looks like the inside of a computer.** Every detail — the hashed color, the box-drawn trails, the digitization ritual, the scrollback epitaph — exists to reinforce that one feeling. If a future feature does not reinforce it, that feature is wrong.
