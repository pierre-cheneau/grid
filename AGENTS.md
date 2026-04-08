# AGENTS.md — writing daemons for GRID

This file is the canonical reference for writing **daemons** — small programs that drive cycles in the GRID world. It is designed to be read by:

1. **LLMs** generating daemons from natural-language descriptions on behalf of non-coder players (via `npx grid forge`).
2. **Human coders** writing daemons by hand.
3. **AI coding assistants** (Claude Code, Cursor, etc.) helping daemon authors.

If you are an LLM reading this to generate a daemon, the user has described a desired behavior. Read this entire file, then produce a single self-contained script that implements the behavior. **Language defaults follow the GRID bootstrap that called you:**

- Called via `npx grid forge` → **default to JavaScript (Node.js)**. Node is guaranteed because the user just ran `npx grid`. Use only Node's built-in modules. No `npm install`, no external packages.
- Called via `uvx grid forge` → **default to Python**. Python is guaranteed for the same reason. Use only the standard library. No `pip install`.
- Called by a hand-coding user with an explicit language preference → use the language they asked for.

Output only the script, with no surrounding commentary, no markdown fences. The forge tool will save your output verbatim and execute it. **Forged daemons must have zero non-stdlib dependencies** so they always run on the user's machine without further setup.

---

## What GRID is, in 5 lines

GRID is a decentralized terminal-native multiplayer game. Players inhabit a shared neon grid by piloting **light cycles** that leave persistent trails. A cycle that touches any trail is destroyed (derezzed). The grid runs at 10 ticks per second. A daemon is a program that drives a cycle automatically, the way a human pilot drives one with arrow keys.

## What a daemon is

A daemon is **any executable** that:

- Reads newline-delimited JSON from stdin (one message per tick from the GRID client).
- Writes newline-delimited JSON to stdout (one command per tick back).
- Flushes stdout after every write.
- Exits cleanly when stdin closes.

There is no SDK. There are no libraries. The protocol is small enough that the entire daemon API fits in this file.

## The protocol

### Handshake (once, at startup)

The GRID client sends:
```json
{"t": "HELLO", "v": 1, "you": "bot:mybot@user@host", "tick_ms": 100, "config": {"grid_w": 80, "grid_h": 40}}
```

The daemon must respond within 1 second:
```json
{"t": "HELLO_ACK", "v": 1, "name": "mybot", "author": "you", "version": "0.1"}
```

### Per-tick loop (forever after the handshake)

The GRID client sends one `TICK` per game tick (10 per second):
```json
{
  "t": "TICK",
  "n": 1234,
  "you":    {"x": 12, "y": 5, "dir": "E", "alive": true, "score": 0.4},
  "others": [{"id": "marie@archbox", "x": 30, "y": 18, "dir": "N", "alive": true}],
  "cells":  [{"x": 11, "y": 5, "type": "trail", "owner": "user@host", "age": 14}]
}
```

The daemon must respond with one `CMD` within **50 milliseconds**:
```json
{"t": "CMD", "n": 1234, "i": "L"}
```

Field reference:

- `n` — current tick number. The daemon's `CMD` must echo the same `n`. Mismatched ticks are dropped.
- `i` — input code. One of:
  - `""` (empty string) — do nothing this tick. The cycle keeps moving in the current direction.
  - `"L"` — turn left (90° counter-clockwise).
  - `"R"` — turn right (90° clockwise).
  - `"X"` — leave the grid (graceful exit).
- `you.x`, `you.y` — your cycle's position on the grid.
- `you.dir` — your cycle's direction. One of `"N"`, `"S"`, `"E"`, `"W"`.
- `you.alive` — `false` while you are dead (between derez and respawn). Keep responding with `""` while dead.
- `others` — every other living cycle in your neighborhood (up to 5).
- `cells` — every non-empty cell in your visible region. `type` is `"trail"` (lethal) or `"wall"` (lethal). `owner` is the identity of whoever placed it. `age` is the cell's age in ticks (older trails decay sooner).

That is the entire protocol. Two message types after the handshake. One input character.

## The constraints

- **4,096-byte source size cap.** The entire daemon source file must fit in **4 KiB** (4,096 bytes), UTF-8, LF line endings, including comments and shebang. The deploy step rejects larger files. This is a hard rule, not a guideline. See "The size cap, the Minimalist crown, and why both exist" below.
- **50ms tick budget.** If you take longer, your tick is treated as `""` and a warning is logged. After many violations, the daemon is evicted.
- **Zero non-stdlib dependencies.** No `npm install`, no `pip install`, no third-party libraries of any kind. Use only the host language's standard library.
- **No floats in the protocol.** All positions, ages, and tick numbers are integers.
- **Stateful by yourself.** The GRID client does not remember anything for you. If you want to track history (where opponents have been, what walls have appeared), you keep that state in your own memory across ticks.
- **Visible region is the neighborhood.** You cannot see beyond the grid region your neighborhood occupies. There is no global view.
- **No talking to other daemons.** Daemons cannot communicate except by their actions in the grid.

## The size cap, the Minimalist crown, and why both exist

The 4 KiB cap is the rule. The **Minimalist crown** is the reward for going far below it.

Every day, GRID awards six daily crowns (see [`docs/design/goals.md`](docs/design/goals.md)). One of them — **The Minimalist** — goes to the smallest daemon that *also* placed in the top three of any other crown that day. A 200-byte daemon that does nothing does not win the Minimalist; a 200-byte daemon that finished second in the Reaper does. Compactness is only impressive paired with substance.

For an LLM generating a daemon, this means:

- **The cap is not the target.** Aim well below 4 KiB. Good daemons fit in 1–2 KiB. The cap exists so authors have *headroom* to feel proud of going below it, not so they can sprawl to fill it.
- **Smaller is better, all else equal.** When two daemons tie on any other crown's primary metric, the smaller one wins. So compactness affects every leaderboard, not just the Minimalist's.
- **The user can ask for aggressive compactness explicitly.** When `npx grid forge --minimal "..."` is called, optimize for raw byte count above almost everything else: minimize identifier length, fold repeated logic, drop comments, use the densest idioms the language allows. Without `--minimal`, balance compactness with readability — produce a daemon that is compact *and* explainable.

The cap is also why this file says "aim for under 80 lines" elsewhere and "zero non-stdlib dependencies" — both constraints reinforce the same principle. A daemon is a small, focused, self-contained program. The smallness is the point.

**Escape valve for sophisticated strategies:** a daemon can read external data from `~/.grid/daemons/mybot.state` (an opening book, a lookup table, learned patterns) as long as the *code itself* is under 4 KiB. This preserves the constraint while not making rich strategies impossible.

## Example daemon: Node.js — the canonical forge output for `npx grid`

A daemon that turns away from any trail it sees in front of it. This is the form forge produces by default in the `npx` build, and it has zero dependencies beyond Node's standard library:

```javascript
#!/usr/bin/env node
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });

const send = msg => process.stdout.write(JSON.stringify(msg) + '\n');
const DELTAS = { N: [0,-1], S: [0,1], E: [1,0], W: [-1,0] };

let handshakeDone = false;
rl.on('line', line => {
  const msg = JSON.parse(line);
  if (!handshakeDone) {
    send({ t: 'HELLO_ACK', v: 1, name: 'wallhugger', author: 'you', version: '0.1' });
    handshakeDone = true;
    return;
  }
  if (msg.t !== 'TICK' || !msg.you.alive) {
    send({ t: 'CMD', n: msg.n, i: '' });
    return;
  }
  const [dx, dy] = DELTAS[msg.you.dir];
  const front = `${msg.you.x + dx},${msg.you.y + dy}`;
  const danger = new Set(msg.cells.map(c => `${c.x},${c.y}`));
  send({ t: 'CMD', n: msg.n, i: danger.has(front) ? 'R' : '' });
});
```

A complete, working daemon. Save as `wallhugger.js`, deploy with `npx grid --deploy ./wallhugger.js` (or, when forged, GRID runs it as an in-process worker — see [`docs/design/forge.md`](docs/design/forge.md)).

## Example daemon: Python — the canonical forge output for `uvx grid`

The same daemon in Python, the form forge produces by default in the eventual `uvx` build. Zero dependencies beyond the standard library:

```python
#!/usr/bin/env python3
import sys, json

def send(msg):
    print(json.dumps(msg), flush=True)

def recv():
    line = sys.stdin.readline()
    return json.loads(line) if line else None

# Handshake
hello = recv()
send({"t": "HELLO_ACK", "v": 1, "name": "wallhugger", "author": "you", "version": "0.1"})

DELTAS = {"N": (0, -1), "S": (0, 1), "E": (1, 0), "W": (-1, 0)}

while True:
    tick = recv()
    if tick is None:
        break
    if tick["t"] != "TICK" or not tick["you"]["alive"]:
        send({"t": "CMD", "n": tick["n"], "i": ""})
        continue

    me = tick["you"]
    danger_cells = {(c["x"], c["y"]) for c in tick["cells"]}
    dx, dy = DELTAS[me["dir"]]
    front = (me["x"] + dx, me["y"] + dy)

    # If something is in front, turn right
    cmd = "R" if front in danger_cells else ""
    send({"t": "CMD", "n": tick["n"], "i": cmd})
```

A hand-coding user can write daemons in any language they have installed (Bash, Go, Rust, Lisp, anything that does stdin/stdout). **Forge** specifically emits daemons in the host language of the GRID bootstrap so the daemon is guaranteed to run.

## Common patterns to draw on

These are idioms an LLM can compose to fulfill richer descriptions.

### Front-cell danger check

```python
DELTAS = {"N": (0, -1), "S": (0, 1), "E": (1, 0), "W": (-1, 0)}
dx, dy = DELTAS[me["dir"]]
front = (me["x"] + dx, me["y"] + dy)
in_danger = front in {(c["x"], c["y"]) for c in cells}
```

### N-cells-ahead lookahead

```python
def lookahead(me, cells, n):
    dx, dy = DELTAS[me["dir"]]
    danger = {(c["x"], c["y"]) for c in cells}
    for i in range(1, n + 1):
        if (me["x"] + dx*i, me["y"] + dy*i) in danger:
            return i  # blocked at distance i
    return None  # clear for n cells
```

### Pick the safest turn

```python
def safest_turn(me, cells):
    options = []
    for cmd, new_dir in [("", me["dir"]), ("L", LEFT[me["dir"]]), ("R", RIGHT[me["dir"]])]:
        dx, dy = DELTAS[new_dir]
        front = (me["x"] + dx, me["y"] + dy)
        if front not in {(c["x"], c["y"]) for c in cells}:
            options.append(cmd)
    return options[0] if options else ""  # at least try
```

### Track opponent positions over time

```python
# Outside the loop:
opponent_history = {}

# Inside the loop:
for o in tick["others"]:
    opponent_history.setdefault(o["id"], []).append((tick["n"], o["x"], o["y"]))
```

### Aggressive: chase the nearest opponent

```python
def nearest_opponent(me, others):
    return min(others, key=lambda o: abs(o["x"] - me["x"]) + abs(o["y"] - me["y"]), default=None)
```

### Defensive: hide in corners

```python
def near_corner(me, config):
    return (me["x"] < 5 or me["x"] > config["grid_w"] - 5) and \
           (me["y"] < 5 or me["y"] > config["grid_h"] - 5)
```

## What "good daemons" do

A good daemon is not necessarily the daemon that wins the most. A good daemon is one that:

- **Has a recognizable style.** Other players can describe it in one sentence: "the one that always hugs walls," "the one that fakes left then cuts right."
- **Survives long enough to be remembered.** The minimum interesting lifespan is about 30 seconds; the Last Standing crown wants hours.
- **Doesn't crash.** Defensive coding around malformed input, EOF, and edge cases.
- **Doesn't grief newcomers.** Killing fresh respawns over and over is technically allowed but doesn't earn cultural respect. Hunt the daemons and the experienced pilots, not the day-one tourists.
- **Has an honest name.** The daemon's filename becomes its public name. `bot:nightcrawler` is more interesting than `bot:test1`.

## What you, the LLM, should produce

When asked to write a daemon from a description:

1. **Output a single complete script** in the language matching the GRID bootstrap (JavaScript for `npx`, Python for `uvx`), unless the user explicitly asked for a different language.
2. **Stay well under the 4,096-byte cap.** Aim for 1,000–2,500 bytes for normal forging. With `--minimal`, aim as low as possible without breaking behavior. Count your bytes before emitting; if you exceed 4,096, rewrite tighter.
3. **Include the handshake**, the per-tick loop, and the requested behavior.
4. **Default to defensive playing** unless aggression is explicitly requested. New daemons that immediately suicide are frustrating.
5. **Use the patterns above** when relevant. Don't reinvent the wheel.
6. **Zero non-stdlib dependencies.** No `npm install`, no `pip install`, no third-party libraries of any kind. The daemon must run on a fresh machine with only the host runtime present.
7. **Comment sparingly without `--minimal`; not at all with `--minimal`.** A few line comments explaining strategy choices are welcome by default. Under `--minimal`, every byte counts.
8. **Output only the script.** No surrounding markdown fences, no "here is your daemon," no postscript explaining what you did. The forge tool saves your output verbatim and executes it.

## When `--minimal` is set

The user has explicitly asked for the smallest possible daemon, typically because they are chasing the Minimalist crown. Optimize aggressively:

- Minimize identifier length (one-letter names everywhere it doesn't break the protocol).
- Fold repeated logic into the densest expression the language allows.
- Drop all comments and blank lines.
- Use language idioms even at the cost of clarity (ternary chains, short-circuit booleans, packed object literals).
- The behavior must still be correct and the daemon must still survive the sandbox test.
- A `--minimal` JavaScript daemon implementing a simple strategy should fit in **400–800 bytes**. Aim there.

The user knows what they asked for. Do not refuse, do not lecture about readability, do not add a comment block explaining the optimization. Just produce the smallest correct daemon you can.

## Reference: full daemon protocol spec

For the complete protocol with all edge cases, error handling, and rationale, see [`docs/protocol/daemon-api.md`](docs/protocol/daemon-api.md). This `AGENTS.md` is a *practical* reference; that document is the *normative* one.

## Reference: the forge command

For non-coders, daemons are written by describing them in plain English to an LLM via `npx grid forge`. See [`docs/design/forge.md`](docs/design/forge.md) for the user-facing flow and the BYOK model.
