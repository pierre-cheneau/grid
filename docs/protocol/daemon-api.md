# Daemon API

The contract between the GRID client and a player-written daemon program. A daemon is a small executable that drives a cycle in the grid the way a pilot would, but algorithmically and continuously.

This protocol is **language-agnostic by design**. Any program in any language that can read a line from stdin and write a line to stdout can be a GRID daemon. There are no SDKs to install, no libraries to learn, no FFI. The simplicity is the point: a daemon is a 20-line Python script, a Bash one-liner, a Common Lisp toy, a Rust binary — whatever the author prefers.

The simplicity also enables **LLM authorship**: a non-coder who cannot write any of these languages can describe the desired behavior in English to `npx grid forge` and get a working daemon back. Daemon authorship is therefore not a coder privilege. See [`../design/forge.md`](../design/forge.md) for the forge command and [`../../AGENTS.md`](../../AGENTS.md) for the LLM-facing practical reference (which is also the friendliest entry point for human readers).

> **Status:** this protocol is fully designed in v0.1. The GRID client does not yet *launch* daemon subprocesses in v0.1 (`--deploy` is reserved). v0.2 implements the bridge. The `npx grid forge` command is also v0.2. `AGENTS.md` ships in v0.1 so AI coding assistants helping daemon authors today already have the context. Daemons written against this spec today — by hand or via an AI assistant — will work in v0.2 unchanged.

## Two relationships to this document

This file is the **normative protocol spec**. It is the source of truth for byte-level message formats and edge cases. It is what implementers of the GRID client and library authors should read.

If you are writing a daemon by hand, **start with [`../../AGENTS.md`](../../AGENTS.md) instead**. It is the same protocol presented as a practical guide with patterns, common idioms, and ready-to-copy examples in multiple languages. This file is the reference; AGENTS.md is the tutorial.

If you are an LLM generating a daemon from a user's description, you should also read [`../../AGENTS.md`](../../AGENTS.md). The forge command bundles that file (not this one) into your prompt because it is the better fit for generation.

## Two execution models, one wire protocol

GRID supports two ways to run a daemon. Both speak the **identical** newline-delimited JSON protocol described in this document; only the transport layer underneath differs.

### Subprocess model (hand-coded daemons, any language)

The user runs:

```
$ npx grid --deploy ./mybot.py
```

The GRID client:

1. Performs the normal join procedure (intro animation, peer connection, identity).
2. Spawns `./mybot.py` as a subprocess with the user's environment.
3. Sets the daemon's name to `bot:mybot@${USER}@${HOSTNAME}` (the script basename minus extension, prefixed with `bot:`, suffixed with the user's identity).
4. Pipes the daemon protocol stream to the subprocess's stdin.
5. Reads command lines from the subprocess's stdout.
6. Relays commands as inputs to the local simulation, exactly as if they were keypresses.
7. When the subprocess exits, or the GRID client exits, the daemon's cycle leaves the grid.

The subprocess's **stderr** is captured and shown in the spectator overlay (with a "daemon log" panel) so the author can debug their bot's output.

This model supports daemons in **any language** the user has installed: Python, Go, Rust, Bash, Lisp, anything that can read stdin and write stdout. The OS handles the language; GRID does not need to know.

### In-process worker model (forged daemons, host language only)

A daemon forged by `npx grid forge` is always emitted in the host language of the GRID bootstrap (JavaScript for `npx`, Python for `uvx`). Because the daemon is in the same language as the GRID client, GRID loads it as an **in-process worker** (`worker_threads` in Node, threads/subinterpreters in the Python build) rather than spawning an external process.

The wire protocol is unchanged: the worker communicates via JSON messages on an in-memory stream that mimics stdin/stdout. From the daemon code's perspective, nothing is different — it reads "lines" and writes "lines" the same way it would in the subprocess model.

The benefits and rationale are documented in [`../design/forge.md`](../design/forge.md). The short version: in-process eliminates runtime-not-installed bugs, lets GRID enforce resource limits cleanly, and starts faster. It is the only execution model that respects the "user only needs the bootstrap runtime" guarantee for non-coders.

A coder who wrote a JavaScript daemon by hand can opt into the in-process model with `npx grid --deploy --inprocess ./mybot.js`. This is a quality-of-life feature; the default for `--deploy` is still subprocess.

### Which model to use

| You are… | Daemon language | Model |
|---|---|---|
| A non-coder using `npx grid forge` | JavaScript (forced) | In-process worker |
| A non-coder using `uvx grid forge` | Python (forced) | In-process worker |
| A coder hand-writing in any language | Anything | Subprocess |
| A coder hand-writing JS in the `npx` build | JavaScript | Subprocess (default) or in-process (`--inprocess`) |
| A coder hand-writing Python in the `uvx` build | Python | Subprocess (default) or in-process (`--inprocess`) |

The rest of this document describes the **wire protocol**, which is identical across both models.

## Daemon size limit: 4,096 bytes

GRID enforces a hard cap on daemon source size: **4,096 bytes (4 KiB)**. Both hand-coded and forged daemons must fit. The cap is enforced at deploy time:

- The deploy step (subprocess or in-process) measures the source file's byte length before launching the daemon.
- Files exceeding 4,096 bytes are **rejected** with a friendly error: `daemon is N bytes, max is 4096 — try removing comments or simplifying logic`.
- The count is bytes of the file as written: UTF-8 encoded, LF line endings (Windows CRLF is normalized to LF before counting), including comments, blank lines, and the shebang line.
- Hand-coders cannot bypass the cap by editing files post-deploy. The check runs every time `--deploy` is invoked.
- Forged daemons are sized at the moment forge writes them to disk; the same cap applies. If forge produces a daemon over 4,096 bytes (rare with a properly tuned LLM prompt), the sandbox rejects it and re-prompts the LLM with a corrective message.

The cap is part of GRID's design pillars (see [`../concept/pillars.md`](../concept/pillars.md), pillar 10) and is the foundation for the **Minimalist crown** (see [`../design/goals.md`](../design/goals.md)). The short version of the rationale: the cap exists to make compactness a craft, to keep the skill ceiling honest, to give the Minimalist crown headroom, and to connect GRID to the demoscene 4K-intro lineage.

### The external-state escape valve

The cap applies to daemon **source code**, not to the data the daemon reads at runtime. A daemon may read from a sibling file in `~/.grid/daemons/` to consult precomputed data — opening books, lookup tables, learned patterns, hand-tuned position evaluations — as long as the daemon code itself stays under 4 KiB.

This preserves the constraint without preventing sophisticated strategies. A daemon author who wants to maintain a 50 KB opening book can do so; they just need to write the lookup logic in 4 KiB of source. The constraint is on the *thinking expressed in code*, not on the *data the code consults*.

Practical pattern, in JavaScript:

```javascript
const fs = require('fs');
const book = JSON.parse(fs.readFileSync(__dirname + '/openings.json', 'utf8'));
// ... use `book` in the per-tick loop ...
```

The `openings.json` file is unlimited in size. The daemon code that reads it must still fit in 4 KiB. The Minimalist crown still measures the *.js* file, not the data file.

### Why 4 KiB and not some other number

4,096 bytes was chosen as the smallest cap that does not censor whole strategic categories (territory analysis via flood-fill, opponent tracking, multi-step path planning all fit comfortably) and the largest cap that still pressures authors to think about size. It is also the famous demoscene "4K intro" number, which gives GRID 30 years of cultural lineage to attach itself to. A more detailed argument for the number is in [`../concept/pillars.md`](../concept/pillars.md).

## The protocol

The daemon protocol is **newline-delimited JSON over stdin/stdout**. The GRID client writes one JSON line per tick to the daemon's stdin; the daemon writes one JSON line per tick to its stdout. Both are required to keep the simulation in lockstep.

### Tick budget

The daemon has **50 milliseconds** per tick to read its input, decide, and write its command. If it misses the deadline, that tick's command is treated as `""` (no input) and a warning is logged. Repeated misses cause the daemon to be evicted by the standard timeout mechanism.

This budget is generous (the simulation tick is 100ms; the daemon gets half) but not infinite. A daemon that wants to run heavy computation should do so asynchronously and respond with whatever its current best decision is.

### Handshake

When the daemon starts, the GRID client first sends a `HELLO` line:

```json
{"t": "HELLO", "v": 1, "you": "bot:mybot@corne@thinkpad", "tick_ms": 100, "config": {"grid_w": 80, "grid_h": 40}}
```

The daemon must respond with a `HELLO_ACK` within 1 second:

```json
{"t": "HELLO_ACK", "v": 1, "name": "mybot", "author": "corne", "version": "0.1"}
```

The `name`, `author`, and `version` fields are advisory and shown in the spectator overlay. The handshake confirms the daemon is alive and speaks the protocol.

### Per-tick messages

After the handshake, every tick the GRID client sends one `TICK` line and expects one `CMD` line in response.

#### `TICK` (client → daemon)

```json
{
  "t": "TICK",
  "n": 1234,
  "you": {
    "x": 12,
    "y": 5,
    "dir": "E",
    "alive": true,
    "score": 0.4
  },
  "others": [
    {"id": "marie@archbox", "x": 30, "y": 18, "dir": "N", "alive": true},
    {"id": "bot:nightcrawler@dev@m1pro", "x": 45, "y": 22, "dir": "W", "alive": true}
  ],
  "cells": [
    {"x": 11, "y": 5, "type": "trail", "owner": "corne@thinkpad", "age": 14},
    {"x": 30, "y": 17, "type": "trail", "owner": "marie@archbox", "age": 3}
  ]
}
```

- `n` — current tick number (matches the simulation tick).
- `you` — the daemon's own cycle state.
- `others` — every other living program in the same neighborhood.
- `cells` — every non-empty cell in the daemon's *visible region* (currently the entire neighborhood, but may be vision-limited in v0.3+).

The exact serialization is canonical and stable across protocol v1. New fields may be added in v2.

#### `CMD` (daemon → client)

```json
{"t": "CMD", "n": 1234, "i": "L"}
```

- `n` — must equal the `n` of the TICK being responded to. Mismatched ticks are dropped with a warning.
- `i` — input code, same as the wire protocol: `""`, `"L"`, `"R"`, or `"X"`.

That's it. The entire daemon API is one TICK message and one CMD response per tick, plus the handshake.

### Death and respawn

When the daemon's cycle is derezzed, the next TICK has `you.alive: false`. The daemon should keep responding with `""` commands (or any commands; they are ignored while dead). After the 3-second respawn delay, the next TICK has `you.alive: true` and a fresh position.

A daemon that wants to exit on death rather than respawn can send `{"t": "CMD", "n": <tick>, "i": "X"}`. This leaves the grid cleanly.

### Errors

If the daemon writes malformed JSON or violates the protocol (e.g., responds to wrong tick), the client logs a warning and treats the tick as `""`. After 10 consecutive errors, the daemon is killed and the cycle leaves the grid with a console error visible to the author.

## Example daemon: Python, ~20 lines

```python
#!/usr/bin/env python3
import sys, json, random

# Handshake
hello = json.loads(sys.stdin.readline())
print(json.dumps({"t": "HELLO_ACK", "v": 1, "name": "random_walker", "author": "you", "version": "0.1"}), flush=True)

# Main loop
while True:
    line = sys.stdin.readline()
    if not line:
        break
    tick = json.loads(line)
    if tick["t"] != "TICK":
        continue
    # Pick a random move 1/10 of the time, otherwise go straight
    if random.random() < 0.1:
        cmd = random.choice(["L", "R"])
    else:
        cmd = ""
    print(json.dumps({"t": "CMD", "n": tick["n"], "i": cmd}), flush=True)
```

This is a fully working daemon. It has no strategy beyond random walks, but it is a complete first program. A novice can copy this, run `npx grid --deploy ./random_walker.py`, and watch their cycle wander the grid forever.

## Example daemon: Bash + jq, ~5 lines

```bash
#!/usr/bin/env bash
echo '{"t":"HELLO_ACK","v":1,"name":"straight_line","author":"you","version":"0.1"}'
while read line; do
  n=$(echo "$line" | jq -r .n)
  echo "{\"t\":\"CMD\",\"n\":$n,\"i\":\"\"}"
done
```

A daemon that always goes straight. Will die quickly. The point is that *Bash can be a daemon*. Any language can.

## Daemon best practices

These are recommendations, not enforcement:

- **Always flush stdout after writing.** The protocol is line-buffered; without flushing, the GRID client never sees your command.
- **Validate the tick number.** If you respond to the wrong tick, the client ignores you and you waste a tick.
- **Keep computation under 50ms.** If you need more time, do it asynchronously and use the latest result.
- **Handle stdin EOF.** When the GRID client exits, your stdin closes. Exit cleanly.
- **Log to stderr, not stdout.** stdout is the protocol channel. stderr is shown in the spectator overlay.
- **Don't trust the input format absolutely.** The protocol is versioned; new fields may appear. Ignore fields you don't recognize.

## What daemons can and cannot do

**Daemons CAN:**

- Read the full visible state of the neighborhood every tick.
- Compute arbitrary strategies in any language.
- Maintain internal state across ticks (each daemon is a continuous process).
- Use any libraries or external tools the author wants.
- Write to local files for debugging or persistence.
- Make HTTP requests (e.g., to a strategy server the author runs).
- Run for hours, days, or as long as the author keeps the process alive.

**Daemons CANNOT:**

- See outside their neighborhood (no global grid awareness in v0.1).
- Cheat the simulation (the lockstep cross-check protects against forged state).
- Take more than 50ms per tick reliably (they will be evicted).
- Communicate with other daemons except via the grid itself (place trails, fight, etc.).
- Pretend to be a pilot or claim a different identity (the daemon name is fixed at launch).

## Why this protocol shape

A few design decisions worth justifying:

- **Why JSON?** Because every language has a JSON parser. Binary protocols would be faster but exclude shell scripts and one-line bots.
- **Why stdin/stdout?** Because every language has stdin/stdout. The OS handles the pipes; the daemon doesn't need a network library.
- **Why one tick per message?** Because the protocol is exactly the lockstep tick rate, so daemons naturally synchronize with the simulation.
- **Why send the whole visible state every tick?** Because daemons are stateless by default, and forcing them to maintain a delta state machine would exclude novice authors. The visible state is small (a few KB) and the bandwidth is local IPC, not network — it's fine.
- **Why no helper SDK?** Because the protocol is simple enough that an SDK would be more code than the daemon itself. A 5-line example in the README is the SDK.

## Implementation notes for v0.1 (protocol only) and v0.2 (bridge)

**v0.1:**
- Document this protocol in the spec (this file).
- Build the daemon-side example scripts so they exist as reference.
- Do NOT build the daemon launch bridge in the GRID client. `--deploy` is reserved but unimplemented.

**v0.2:**
- Implement subprocess launch with stdin/stdout pipes.
- Implement the handshake and per-tick message loop.
- Implement the spectator overlay's daemon log panel.
- Add example daemons to the GRID repo's `examples/daemons/` folder (Python, Go, Rust, Bash).
- Document daemon mode in `npx grid --help` (still not in the main UI).
