# Goals, crowns, and decay

## Why GRID has no single win condition

Battle Royale works because it has one tight goal ("be the last") and one tight loop (one match, one winner, start over). GRID is structurally different: it is a persistent place, not a sequence of matches. A persistent place cannot have "be the last one standing" because the place never ends.

The right design move is to keep what BR teaches — *clear stakes, visible time pressure, rare and meaningful winners* — and build a goal structure that fits a *place* rather than a *match*. GRID's goal structure is **layered across four timescales**, each with its own stakes and its own kind of victory.

## The four timescales

| Timescale | Duration | What it asks of you | What you get |
|---|---|---|---|
| **Moment** | seconds | Survive, fight, build, destroy. The cycle physics. | Adrenaline, the next decision. |
| **Session** | ~90s pilot, hours/days daemon | Make this run count. Place a memorable mark. | A line in your scrollback epitaph. |
| **Day** | 24 hours | Win one of six daily crowns. | Public recognition in the day's recap. Your name remembered in the archive. |
| **History** | forever | Do something so impressive it lives in the permanent archive. | Your name referenced by other players for years. |

Every player, at every moment, has a goal at every horizon. A pilot pressing arrow keys has a moment-to-moment goal (don't die), a session goal (place a great mark), a day goal (rank for the Mayfly crown), and a forever goal (be in the archive). They don't need to be aware of all four, but the structure rewards each one independently. This is the structural reason GRID can be both coffee-break-friendly and decade-deep.

## The six daily crowns

Every 24 hours (midnight UTC, with regional variants in v0.2), the day's grid is reset and a recap is computed. The recap names up to six crown-holders, one per category. Each crown rewards a different virtue. *Six different heroes per day. Six different stories told.*

The six together form a small pantheon of geek values: **endurance, aggression, creation, emergence, the heroic moment, and craftsmanship**. No crown is "the best." A player who has been on the grid for years has probably won each at least once, in different moods, in different daemons, with different intent. That is what identity in GRID looks like.

### 1. The Last Standing
> The program that lived longest in today's grid without being derezzed.

Almost always a daemon — pilots rarely survive more than a few minutes. Occasionally, a daring pilot who plays a careful late-night session can hold the title for an hour. Rewards endurance and defensive design. The crown most associated with daemon mode.

**Computed from:** the wall-clock duration of each individual cycle's life. A program that respawns starts a new candidacy.

### 2. The Reaper
> The player with the most derezzes of *named programs* during the day.

"Named programs" means other daemons or pilots that have been alive long enough to be recognized in the recap (at least 30 seconds of life). This excludes farming respawn-fodder pilots. Rewards aggression and offensive skill. Equally winnable by pilots and daemons.

**Computed from:** kill counts in the day's tick log, filtered by victim age.

### 3. The Architect
> The player whose placed cells covered the most grid-area at end of day, weighted by how long each cell survived.

A cell that lived 30 seconds counts less than a cell that lived an hour. A cell that was destroyed by an opponent counts less than a cell that decayed naturally. Rewards creation, patience, and structural thinking. Currently a daemon-leaning crown because v0.1 doesn't have a structure-placement verb (only trails count); v0.2 will introduce explicit structures and rebalance.

**Computed from:** an integral over the day's tick log of `(cells alive × tick) per owner`.

### 4. The Catalyst
> The player whose actions triggered the largest cascading chains.

A "cascade" is a sequence of events causally linked to a single action: kills that led to kills, structures that enabled other players' kills, traps that caught multiple programs in sequence. Hardest crown to game, most prestigious. Rewards cleverness and emergent thinking.

**Computed from:** a causal-graph analysis of the day's tick log. The exact algorithm is one of the secret hard problems of GRID and will be tuned over time. v0.1 ships a simple version (kills-attributed-to-your-walls + chain-kills); v0.2 deepens it.

### 5. The Mayfly
> The single 90-second pilot session with the highest impact score in the day.

This crown exists *specifically so a pilot can wake up tomorrow and find that they won a crown*. Without it, the daily recognition system would lean entirely toward daemons, which would make pilots feel second-class. The Mayfly is structurally critical for inclusion. **Do not remove it. Do not let daemons compete for it.**

**Computed from:** for each pilot session in the day (defined as a continuous span of human-driven play, broken when the pilot exits or is idle for >2 minutes), compute `derezzes + (longest_run_seconds / 10) + cells_painted / 20`. Highest score wins. Ties broken by earliest in the day.

### 6. The Minimalist
> The smallest daemon that placed in the top three of any other crown today.

The Minimalist is the craftsman's crown. It rewards a specific virtue with a deep geek lineage: doing more with less. Code golf, demoscene 4K intros, IOCCC, the Forth ethos, the Unix philosophy — all the same family of values, none of which has had a real-time multiplayer game to attach itself to until now.

The constraint matters: a 200-byte daemon that does nothing does *not* win the Minimalist. A 200-byte daemon that finished second in the Reaper does. The crown is awarded to the daemon with the smallest source size that was *also* good enough to place in the top three of at least one other crown that day. Compactness is only impressive when paired with substance.

**Eligibility:**
- Daemons only. Pilots have no source size and are not eligible. (Pilots have the Mayfly; daemons have the Minimalist. The two populations have one population-specific crown each, by design.)
- The daemon must have ranked 1st, 2nd, or 3rd in any of the Last Standing, Reaper, Architect, or Catalyst metrics for the day (even if the actual crown went to someone else).
- Both hand-coded and forged daemons are eligible. Forged daemons are typically larger by default; non-coders chasing the Minimalist can use `npx grid forge --minimal "..."` to instruct the LLM to optimize aggressively.

**Computed from:** the byte count of the daemon's source file as deployed (UTF-8, LF line endings, including comments and shebang). The smallest eligible daemon wins. Ties broken by the daemon that placed *highest* in any other crown.

**What if no daemon was eligible?** On low-population days where nothing placed in any top three, the Minimalist is simply not awarded. The recap names five crowns instead of six. Small days, small recognition.

**Why this shape:**
- It widens the daily spotlight by exactly one player without diluting the other crowns. The Minimalist will often be a player who placed second or third in another crown — someone the recap would not otherwise have named.
- It rewards style across categories. A player whose Minimalist daemon hunted opponents one day and built structures another is showing range; compactness becomes a personal craft that travels across playstyles.
- It connects GRID to a 30-year demoscene lineage in a single, unmistakable signal: a sixth crown for *the smallest thing that worked*.

## The size cap and the tiebreaker

GRID enforces a hard limit on daemon source size: **4,096 bytes (4 KiB)**. This cap applies to all daemons (hand-coded and forged) at deploy time. A file exceeding the limit is rejected with a friendly error. See [`../protocol/daemon-api.md`](../protocol/daemon-api.md) for the enforcement details and the external-state escape valve.

The cap exists for three reasons:
1. **It makes the Minimalist crown meaningful.** Without a cap there is no upper bound to compete against; with a cap that's deliberately *higher* than what good daemons need, the Minimalist gap becomes a real achievement.
2. **It keeps the skill ceiling honest.** Without a limit, the "best" daemon is whoever has the most engineering hours. With a limit, the best daemon is whoever thinks most clearly within the constraint. Chess, not arms race.
3. **It protects the in-process worker model.** A bounded source size implicitly bounds startup time, memory footprint, and tick latency, which makes resource enforcement clean.

The 4 KiB number is chosen as the smallest cap that does not censor entire strategic categories (territory analysis via flood-fill, opponent tracking, multi-step path planning all fit comfortably) and the largest cap that still pressures authors to think about size. It is also the [4K intro](https://en.wikipedia.org/wiki/4K_intro) demoscene tradition, which gives GRID a 30-year cultural lineage to attach itself to without explanation.

**The size tiebreaker on other crowns.** When two daemons tie on the primary metric of any other crown (Last Standing, Reaper, Architect, Catalyst), the daemon with the **smaller source file** wins the crown. This means the cap is felt softly on every leaderboard, not just the Minimalist's. A hand-coding coder who keeps their bot tight has a structural edge over one who lets it sprawl. The tiebreaker does not apply to pilot scores (the Mayfly), which use their existing earliest-action rule.

## Decay: the physics constant that makes the goals work

GRID is **constantly decaying**. This is not a goal; it is a *condition* underlying every other goal.

- Trail cells have a half-life of approximately 60 seconds (subject to tuning).
- Empty regions of the grid slowly contract toward the active center.
- Structures placed by players (v0.2+) require maintenance — passive structures lose integrity over time and eventually disappear.
- The grid's overall size scales with population: the more active programs, the more cells the grid maintains.

Decay does three jobs simultaneously, and all three are essential:

1. **It prevents clutter accumulation.** Without decay, the daily grid would be choked with dead trails by hour six and unplayable. Decay keeps the grid breathing.
2. **It rewards active play.** Your influence is something you maintain, not something you bank. Walking away from the grid means your contribution fades. This is what makes returning matter.
3. **It creates the natural creation/destruction tension.** Pure builders are punished by entropy alone (their structures decay if unattended). Pure destroyers are punished because the grid grows sparse and uninteresting if there's nothing to destroy. The optimal play is *both*, which is exactly the ecological balance the design wants.

Decay calibration is the secret hard problem of GRID. There is no theoretical right answer. The half-life will be tuned across many real play-sessions in the weeks after launch. Expect it to change.

## Why no global score, no leaderboard, no rank

GRID intentionally has no global "GRID rating" or rank. The reasons:

- **Ranks turn games into work.** A persistent rank creates pressure to "not lose points," which makes losing painful, which makes players quit.
- **Ranks centralize identity.** A player with rank 1247 *is* their rank, and rank requires a server to maintain authoritatively. GRID has no server.
- **Ranks reward grinding.** GRID rewards *being there*, not playing more. The daily crown structure means a player who plays five minutes once a week has the same crown-eligibility as one who plays five hours a day.
- **Ranks compress identity into one number.** GRID's whole identity model is "you are a citizen of a place, recognizable by your style, your name, and your history." A single rank number erases all of that.

The only persistent reputation in GRID comes from the **archive**: did you win a crown on day N? What did you do on day M? Other players can browse this history and know who you are. That is the only ranking GRID needs.

## How the goals serve the four retention features

Cross-checking against the design pillars (see [`concept/pillars.md`](../concept/pillars.md)):

| Retention feature | How the goal structure serves it |
|---|---|
| Unreachable skill ceiling | Six different crowns mean six different mastery curves; the Catalyst has no ceiling because emergent cascades are unbounded; the Minimalist has no ceiling because compactness is a craft you can refine forever. Daemon mode adds programming itself as a skill axis. |
| Story-generating emergence | Decay + trails + persistent state + crowns = small ecology = stories. The Catalyst explicitly rewards emergent cascades. The Minimalist surfaces hidden craftsmanship players would otherwise overlook. |
| Self-expression surface | Six crowns = six legitimate playstyles. A "Reaper main" plays differently from an "Architect main," a "Minimalist main" plays differently from both, and all are valid. |
| Culture-friendly | Daily recaps are shared events. The archive accumulates references. Crown winners become known. The Minimalist crown specifically connects GRID to the demoscene/code-golf/IOCCC lineage and brings that audience along. |

## Open questions for v0.2 and beyond

Things deliberately unresolved at the spec stage:

- **Should crowns be computed by every peer locally, or by a subset of "witness" peers, or by the archive replay?** Probably the last, but this needs real design.
- **Regional grids:** does GRID stay one global grid forever, or shard by region after some scale? Either is defensible.
- **Crown ties:** broken by smaller daemon size for the four daemon-eligible crowns; broken by earliest action for the Mayfly. Ties on the Minimalist itself are broken by highest placement in any other crown.
- **Crown decay:** should yesterday's crown winners get any in-grid recognition (a small badge, a name color tweak)? Tempting but possibly violates the "identity is derived" pillar. Default no.
- **Anti-farming for the Reaper:** the 30-second-victim filter is a first guess. Will need tuning.
- **The 4 KiB cap calibration:** is 4,096 bytes the right number? It is chosen to comfortably admit territory analysis and multi-step planning while still pressuring authors. May be revised after a few weeks of real play, in either direction. The Minimalist crown is what makes the cap *competitive* rather than *restrictive*; if the cap is changed, the Minimalist's design does not need to change with it.

These are design questions, not technical ones, and they will be answered after some real play happens.
