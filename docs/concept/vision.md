# Vision

## What GRID is

GRID is a small, decentralized, terminal-native persistent world inspired by the visual language of Tron. It runs on any modern terminal, requires no installation beyond a single bootstrap command (`npx grid`), and connects players directly to each other peer-to-peer with no server you operate.

It is designed to be played in ninety seconds — coffee-break length — and to be inhabited for ten years.

## What GRID is *not*

GRID is not a Tron clone. The light cycle is the *first verb* of the world but not its identity. The identity is the world itself: a shared neon grid that persists across sessions, accumulates history, and is inhabited by a small ecology of human-piloted cycles and player-written programs.

GRID is not a hype game. It is not designed to peak in week six and die in week eight. The design is structurally hostile to the hype loop: there is no progression, no loot, no season pass, no account, no leaderboard you climb. There is only the grid, and what you and other people did in it today.

GRID is not a game with a server. It is a game with *no operator*. The networking runs over WebRTC mesh, signaling rides on public Nostr relays, the daily archive lives in a public git repository. No one — including the original author — can shut GRID down once it is running in the wild.

## The fantasy

The deepest geek fantasy that Tron only half-delivered is *"I am a process inside the machine, playing other processes on other machines."* Most games gesture at this metaphorically. GRID delivers it literally:

- Your identity comes from your real machine (`${USER}@${HOSTNAME}`).
- The game runs in the same place real programs run — your terminal.
- Every other player is a real human at a real terminal somewhere on Earth, connected directly to you.
- If you choose, your "play" can be a small program *you wrote* that lives in the grid alongside other programs.
- The grid is a real shared substrate that programs read and write.

No browser game and no AAA studio can deliver this. The terminal + P2P stack is the only setup in gaming where the metaphor stops being a metaphor.

## Two ways to inhabit

GRID has exactly two valid modes of participation, both first-class:

1. **Pilot mode** (the default). You drive a light cycle with arrow keys for ninety seconds at a time. No setup, no reading required. This is the doorway, and it is a complete game on its own.
2. **Daemon mode** (optional, discoverable). A small program drives a cycle for you, lives in the grid for hours or days, and plays while you are away. There are two paths to authoring a daemon, both equally legitimate:
   - **Hand-written.** A coder writes the program in any language that can read stdin and write stdout — Python, Go, Bash, Lisp, anything. Daemon code is shared on GitHub like speedrun routes.
   - **Forged from a description.** A non-coder runs `npx grid forge "a defensive bot that hides in corners"`, an LLM writes the daemon for them from the description, the result is sandbox-tested, and they deploy it the same way as a hand-coded one. The non-coder never reads code. See [`../design/forge.md`](../design/forge.md).

Both modes — and both daemon-authoring paths — share the same wire protocol. The grid does not know or care which is which. A pilot fighting a daemon, a hand-coded daemon fighting a forged one, and two daemons fighting each other are all mechanically identical from the world's point of view. **The daemon ecology is not a coder privilege**; it is a path open to anyone who can describe a behavior in English.

## The core test

Every design decision in GRID is judged against one question:

> Does this make GRID more of a *place*, or more of a *game*?

If the answer is "more of a place," do it. If "more of a game," think twice. Games end. Places persist.

## What makes GRID worth building

Three things, none of which are individually new but which have not been combined before:

1. **A persistent shared world that geeks can inhabit on a coffee break**, not as a metaphor but as a real continuous place with memory.
2. **Two valid ways to participate** — reflexes and code — both equally welcome, neither one a tax on the other.
3. **True decentralization** — the world cannot be shut off, monetized, or owned by anyone, including the people who made it.

Each of these has been done before in isolation. SSHTron is terminal-native but server-hosted and ephemeral. Screeps has programmable bots in a persistent world but lives in a browser and is not coffee-break friendly. Wordle has a daily ritual and shared global state but isn't real-time and isn't a place. NetHack has cultural permanence and terminal aesthetics but is single-player. GRID is the intersection.

## The success criterion

GRID is successful if, in 2032, a player somewhere can type `npx grid`, find a populated arena, recognize a few names, see a structure they remember from last month, and play for five minutes between meetings — without any of the original authors having lifted a finger in the past year. That is what permanence looks like, and that is what the architecture is designed to make possible.
