# Forge: daemon authorship for everyone

> *"Describe your bot in English. It plays in the grid an hour later."*

Forge is the bridge that makes daemon authorship accessible to non-coders. It is a single command — `npx grid forge` — that takes a plain-English description, asks an LLM to write a daemon implementing it, sandboxes the result, and deploys it. The non-coder never sees code, never installs a runtime, never reads the protocol. They describe a behavior, and a daemon plays in the grid carrying their style.

This document covers the *why*, the *user flow*, the *technical architecture*, and the *cultural considerations*. For the LLM-facing daemon reference that powers forge, see [`AGENTS.md`](../../AGENTS.md). For the underlying daemon protocol, see [`../protocol/daemon-api.md`](../protocol/daemon-api.md).

## Why forge exists

Without forge, GRID has two tiers:

- **Pilots** (anyone) — drive a cycle with arrow keys. A complete game.
- **Daemon authors** (coders only) — write programs that live in the grid for hours or days, develop a recognizable style, become famous in the community.

Pilot mode is fun, but it cannot deliver some of the deepest things GRID offers: a daemon that *carries your style*, a bot that fights *for you while you sleep*, a name in the archive that says *you wrote that*. These belong to coders by default.

Forge makes them belong to everyone.

The pillar this serves is **Pillar 2: Two valid modes, one world**. The original wording assumed daemon authorship was a coder activity and pilot mode was the inclusion path for everyone else. Forge changes that assumption: daemon authorship is now *also* an inclusion path. A non-coder who plays for a year can have a daemon in the grid that fights with their name on it, and that is no longer a coder privilege.

This is structurally important. The four retention features (skill ceiling, story generation, self-expression, culture) all get *stronger* when the author base widens. More authors means more strategies, more diversity, more stories, more shared references. Forge is not a feature for non-coders; it is a way to make the entire grid richer for everyone.

## The user flow

A non-coder discovers `forge` after playing pilot mode for a while. They run:

```
$ npx grid forge "a defensive bot that hides in corners and only fights when it has the high ground"
```

The forge command:

1. **Loads the prompt context.** It bundles `AGENTS.md` (the LLM-facing daemon reference), the user's description, and a brief instruction template into a single prompt.
2. **Sends the prompt to the user's configured LLM.** See "BYOK" below for how this is configured.
3. **Receives a daemon script.** The LLM returns a single Python (or other-language) file implementing the requested behavior.
4. **Saves the script.** Written to `~/.grid/daemons/cornered.py` (the filename derived from the first noun-phrase of the description).
5. **Sandbox-tests it.** The forge runs the new daemon in a private 60-second test grid populated with a few stub opponents. The daemon must complete the handshake, respond to ticks within the budget, and survive at least 5 seconds without crashing.
6. **Reports the result.** Either:
   - **Success:** "✓ `cornered` is ready. Deploy it with `npx grid --deploy ~/.grid/daemons/cornered.py`."
   - **Failure with diagnosis:** "✗ `cornered` crashed at tick 14: KeyError 'dir'. Want me to try fixing it?" The diagnosis comes from the same LLM, given the script and the error.
7. **Optional immediate deploy.** If the user passes `--deploy`, forge deploys the daemon directly into today's grid as soon as it passes the sandbox test.

### Iteration

```
$ npx grid forge --refine cornered "make it more aggressive when its trail is short"
```

This re-prompts the LLM with the existing daemon, the user's refinement description, and (optionally) the result of recent sandbox runs. The LLM produces an updated version. Same flow: save, sandbox-test, report.

The user iterates by *describing what should be different*, not by editing code. This is the entire UX promise of forge: the gap between *idea* and *daemon-in-the-grid* is one English sentence and one command.

### Going small: the `--minimal` flag and the Minimalist crown

GRID enforces a 4,096-byte cap on every daemon, and one of the six daily crowns — **The Minimalist** (see [`goals.md`](goals.md)) — is awarded to the smallest daemon that placed in the top three of any other crown that day. Non-coders chasing the Minimalist crown have a one-flag affordance:

```
$ npx grid forge --minimal "a defensive bot that hunts when its trail is short"
```

The `--minimal` flag instructs the LLM to optimize aggressively for byte count: minimize identifier length, fold repeated logic, drop comments, use the densest idioms the language allows. A `--minimal` JavaScript daemon implementing a simple strategy typically fits in **400–800 bytes**, well below the 4 KiB cap.

A minimal daemon is harder to read but identical in behavior to a normal one. The forge sandbox tests it the same way and reports the same diagnostics. The user gets a tiny, dense daemon they can deploy to chase the Minimalist crown while still describing the strategy in plain English.

### The byte-count display

After every successful forge (with or without `--minimal`), the user sees the daemon's size and how it compares to the cap:

```
$ npx grid forge "a defensive bot that hides in corners"

✓ cornered.js — 1,247 bytes / 4,096 max  (30% of cap)
  ready to deploy: npx grid --deploy ~/.grid/daemons/cornered.js
```

This makes the constraint visible and concrete from day one. It also gently educates non-coders about why smaller is better, without lecturing. A non-coder who notices their daemon is 87% of the cap can run `forge --refine cornered "make it smaller"` and watch the number drop. The display turns the byte cap from a hidden rule into a small game-within-the-game.

For chasing the Minimalist crown specifically, the display also shows a percentile against today's other deployed daemons (when available):

```
✓ cornered.js — 612 bytes / 4,096 max  (15% of cap, smaller than 91% of today's daemons)
```

Refining for compactness is one English sentence:

```
$ npx grid forge --refine cornered "make it smaller"
```

The LLM rewrites the daemon for compactness while preserving behavior. The new size is reported. The user can iterate until they hit a number they're proud of.

### Inspecting and forking

```
$ npx grid forge --show cornered          # print the script (the curious can read it)
$ npx grid forge --fork bot:nightcrawler  # download a famous daemon from the archive and use as starting point
```

Non-coders never need to read the script. Coders and curious non-coders can. The script is just a file in `~/.grid/daemons/`; nothing about forge prevents direct hand-editing.

## BYOK: bring your own key

The forge command needs an LLM to call. There are three plausible ways to provide one, and only one of them is compatible with GRID's pillars.

### Option A: GRID maintainers host an LLM endpoint
**No.** This breaks Pillar 3 (No server, no operator, no kill switch) immediately. The maintainers would have an API bill, an abuse surface, and a kill switch. The entire decentralization story collapses for the sake of one feature. Non-starter.

### Option B: Local LLM
GRID detects Ollama or LM Studio on the player's machine and uses it. Zero cost, fully decentralized, respects all pillars. Downside: in 2026, local LLMs are good enough for daemon-writing only at the high end (32B+ models on capable hardware). Most laptops cannot run them. Local LLM is a *fallback*, not the default.

### Option C: Bring your own key
The player configures their own API key to a hosted LLM (Claude, OpenAI, or any compatible endpoint). GRID never touches the key. Forge calls the LLM directly from the player's machine to the LLM provider; no GRID-operated infrastructure is in the path.

**This is the right answer.** It is honest, decentralized, and respects every pillar. The cost is modest friction: a non-coder who doesn't already have an API key has a new sub-problem to solve (signing up to an LLM provider, getting a key, setting an environment variable).

### The configuration

```
$ export ANTHROPIC_API_KEY=sk-ant-xxx     # or OPENAI_API_KEY, or GROQ_API_KEY, etc.
$ npx grid forge "..."                    # forge auto-detects which provider to use
```

The forge command looks for env vars in priority order: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GROQ_API_KEY`, then a local `OLLAMA_HOST`. The first one set wins. If none is set, forge prints a friendly explanation:

```
$ npx grid forge "..."

forge needs an LLM to write your daemon. set one of these and try again:

  ANTHROPIC_API_KEY  — get one at console.anthropic.com
  OPENAI_API_KEY     — get one at platform.openai.com
  OLLAMA_HOST        — install Ollama locally for free, no key needed
                       https://ollama.com

forge calls the LLM directly from your machine. no GRID infrastructure is
involved. your description and the daemon code never touch any GRID server,
because there is no GRID server.
```

The configuration is one environment variable, set once. The friction is real but it is the *only* friction, and it is honest about why the friction exists.

## Runtime guarantee: forge never assumes anything beyond the GRID bootstrap

The whole point of `npx grid` (or `uvx grid`) is that the user needs *exactly one runtime* to play GRID — the one their bootstrap installer provides. Forge must respect this. A forged daemon that requires Python on a Node-bootstrapped machine, or Node on a Python-bootstrapped machine, is a bug: the user has no idea the LLM picked a language they don't have, and their daemon refuses to run for reasons they cannot diagnose.

The rule:

> **Forge always emits daemons in the host language of the GRID bootstrap.**
>
> - `npx grid forge "..."` → JavaScript daemon, run by the same Node that runs GRID itself.
> - `uvx grid forge "..."` → Python daemon, run by the same Python that runs GRID itself.

This is enforced in three places:

1. **The forge prompt instructs the LLM** which language to emit, based on which build of GRID is calling it. `AGENTS.md` documents this so the LLM has unambiguous guidance.
2. **The forge sandbox refuses to deploy** a daemon whose detected language doesn't match the host. If the LLM disobeys and emits Python from a Node bootstrap, the sandbox catches it and re-prompts the LLM with a corrective message.
3. **Forged daemons run in-process** (see "Execution model" below), which makes the language guarantee structural rather than aspirational.

Hand-coded daemons (`npx grid --deploy ./mybot.py`) are **unaffected**. A coder who deliberately wrote a Python daemon and has Python installed can deploy it freely. The language-agnostic story for coders is preserved exactly as before. The runtime-guarantee rule applies only to the forge path, where the user did not choose the language and cannot reasonably be expected to install a runtime for it.

## Execution model: forged daemons run in-process

Hand-coded daemons run as **subprocesses**: the GRID client launches the daemon executable, pipes JSON over its stdin/stdout, and reads commands back. This is what `--deploy ./mybot.py` does. It supports any language because the OS handles the language for us.

Forged daemons follow a different execution model: they run **in-process as a worker thread** inside the GRID client. Because the forged daemon is JavaScript (in the `npx` build) and the GRID client is also JavaScript, GRID can load the daemon directly into a Node `worker_thread` (or, in the future Python build, a Python worker process or thread) instead of spawning an external process.

The benefits of this model are large:

- **No subprocess launch overhead.** Forging and deploying is near-instant.
- **No PATH lookup, no executable bit, no shebang requirements.** The daemon is just a `.js` file in `~/.grid/daemons/`.
- **No Windows-specific permissions issues** with executable scripts.
- **Clean resource limits.** The 50ms tick budget, the memory cap, and the CPU budget are all enforced by the GRID client directly rather than relying on OS process scheduling.
- **Crash isolation without process isolation.** A worker that throws an exception is restarted or evicted without killing the GRID client.
- **Same wire protocol.** The worker still communicates via JSON messages on a virtual stdio pair (in-memory streams), so the protocol is identical to the subprocess case. A daemon written for one execution model works under the other with no changes.

The wire protocol is the contract; the execution model is an implementation choice. Forged daemons get the in-process model because GRID can guarantee the language. Hand-coded daemons get the subprocess model because GRID cannot.

A coder who wrote a JavaScript daemon by hand can also opt into the in-process model with `npx grid --deploy --inprocess ./mybot.js`. This is a quality-of-life feature for coders working in the host language; it is the default for forge.

## The sandbox

Newly forged daemons are not deployed into the live grid blindly. They are first run in a **private sandbox** for 60 seconds against a small set of stub opponents (2-3 daemons of varying simple behaviors). The sandbox verifies:

- The daemon's source file is **at most 4,096 bytes**. Files over the cap are rejected and the LLM is re-prompted with a corrective message ("you produced a 4,612-byte daemon, the cap is 4,096 — produce a smaller version").
- The daemon completes the handshake.
- The daemon responds to ticks within 50ms consistently.
- The daemon does not crash.
- The daemon survives at least 5 seconds (sanity check that it isn't immediately suiciding).
- The daemon's stderr output is reasonable in size (no log floods).

A daemon that fails any of these is rejected. The forge command reports the failure in plain English (generated by the LLM that wrote the bot, given the error context) and offers to attempt a fix. This is the iteration loop in disguise — failed forges are how the player learns what to ask for.

The sandbox is a **completely local simulation**. It does not touch the network, does not connect to the live grid, and is deterministic. It is the same simulation core used in real play, just running on local-only inputs. This matters because:

- Sandboxing is fast (a 60-second test runs in a few seconds of wall-clock if simulated faster than real time).
- Sandboxing protects the live grid from broken bots.
- Sandboxing protects the player from sharing a bot that doesn't actually work.

## Cultural considerations

Forge changes the social dynamics of GRID in ways worth being honest about.

### The "I made this" feeling for forged daemons

A coder who writes their own daemon line by line owns it deeply. A non-coder who described "a defensive bot" and got code back has a *different* relationship with the result. Is that ownership real?

The answer is yes, but it is the ownership of a *director*, not a *carpenter*. Film directors don't operate cameras; they communicate intent and judge results. Authorship-by-description is real authorship, just at a different layer of the stack. The culture has to be careful not to gatekeep the difference: "hand-coded daemon" must not become a status symbol that demotes forged daemons. They are equal citizens of the grid.

The clearest signal that the culture is healthy is that the daily recap and the archive *do not distinguish* between forged and hand-coded daemons. Both are just "daemons." Their style and their results are what matter, not how their code came to exist.

### Daemon homogenization

If everyone forges daemons through the same LLM with the same `AGENTS.md`, the daemons might converge on similar styles. The community loses diversity.

The mitigation is built into the medium: good prompts produce diverse outputs. The same description "an aggressive bot" produces dozens of valid implementations across runs. The iteration loop (`forge --refine`) personalizes them further. And as forge users grow more sophisticated, they describe more specific behaviors, which produce more distinctive code.

The anti-mitigation is keeping the temperature too low or the prompt too prescriptive. The forge prompt should encourage variety, not optimize for "the best daemon." The goal is *expressiveness*, not *win rate*.

### Quality floor and grid pollution

LLM-forged daemons might be buggy, slow, or boring in ways that pollute the grid. The sandbox catches the obvious failures (crashes, timeouts), but it cannot catch "boring." A grid full of identical defensive daemons is a worse grid than a grid with five hand-written ones.

Mitigation: the sandbox rejects daemons that don't *do anything* (e.g., always send `""`). The forge prompt encourages distinctive behavior. And ultimately, the decay physics of the grid mean that boring daemons get out-competed naturally — they don't survive long, they don't earn crowns, they don't get remembered. The grid sorts itself.

### AI-skeptical players

Some geeks will hate forge on principle. The mitigation is that **forge is one command of many**, not the front door. Pilot mode is unchanged. Hand-coded daemons are still first-class. Non-LLM players are unaffected. The only way to alienate AI-skeptical players is to make forge *the default path*, which it must not be. It is a discoverable affordance for those who want it.

The doorway to GRID remains `npx grid`. Forge is reached by curiosity, not by funnel.

## Roadmap status

Forge is a **v0.2 feature** alongside the daemon subprocess bridge. The v0.1 prerequisites:

- `AGENTS.md` is published as part of v0.1, even though forge does not exist yet. This ensures AI coding assistants used by daemon authors today have the context they need.
- The daemon protocol in v0.1 is daemon-ready by design. Forge adds an authorship layer on top; it does not change the protocol.
- The sandbox uses the same simulation core as live play, which is built in stage 1 of v0.1. No additional engine work is needed for forge in v0.2.

The forge command itself, the prompt assembly, the LLM provider abstraction, and the sandbox runner are all v0.2 work.

## Implementation notes for v0.2

- Provider abstraction: a thin module that detects which provider key is set and calls the appropriate API. Anthropic, OpenAI, Groq, and a local-Ollama adapter at minimum.
- Prompt assembly: load `AGENTS.md` from the package, append a short forge-specific instruction header, append the user's description. Keep the prompt under 8K tokens.
- Output extraction: the LLM returns a single script. Strip any surrounding markdown fences if present. Save to disk verbatim.
- Sandbox runner: spawn the daemon as a subprocess, feed it 600 ticks of fake game state (60 seconds at 10 ticks/sec) drawn from a fixed seed, observe behavior, report.
- Refinement: `--refine <name> <description>` reads the existing daemon, appends "the user wants to change this:" to the prompt, and asks the LLM for a unified updated version.
- Diagnosis-on-failure: when sandbox-test fails, send the LLM the script + the error and ask for a one-paragraph plain-English explanation. Show that to the user.

## Implementation notes for v0.1 (none, except)

v0.1 ships nothing of forge except the `AGENTS.md` file at the project root. This is enough to (a) help any coder using an AI assistant to write daemons, and (b) freeze the LLM context that v0.2's forge will use, so the spec is stable when the implementation lands.
