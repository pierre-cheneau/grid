# Dependencies

The rules for adding, vetting, and maintaining third-party dependencies. The principle: **every dependency is a permanent decision**. Adding one is cheap; removing one is expensive; auditing one is your responsibility forever.

GRID's competitive advantage is being small, decentralized, and unkillable. Every dependency erodes one of those properties. The bar for adding a dependency is therefore high.

## The default answer is no

When you're tempted to add a dependency, the default answer is **no**. Try the following first, in order:

1. **Use Node's standard library.** Most things you need (`fs`, `path`, `crypto`, `child_process`, `worker_threads`, `readline`, `events`) are already there. Read the Node docs before searching npm.
2. **Write it yourself.** A 30-line implementation of the thing you need is almost always better than a 30,000-line dependency that does that thing plus 50 others. The 30 lines are auditable, debuggable, and yours.
3. **Vendor a small implementation.** If you need a known algorithm (PCG32, SHA-256, a small parser), copy the reference implementation into the codebase as a single file. Vendoring 100 lines is not a dependency; it's a piece of code you now own and can modify.
4. **Then, and only then,** consider adding a dependency.

## When a dependency is justified

A dependency is justified when **all** of these are true:

- The functionality is genuinely complex (not "I don't feel like writing it").
- A high-quality, well-maintained implementation exists.
- The maintenance burden of writing it ourselves would be high.
- Removing the dependency later would be feasible if needed.
- The dependency does not undermine GRID's core properties (decentralization, determinism, no operator).

Example: **Trystero** is justified. WebRTC + Nostr signaling is genuinely complex, Trystero is well-maintained, writing it ourselves would be a significant project, the API is small enough that we could replace it later if needed, and it doesn't undermine decentralization (it's a thin wrapper over public Nostr relays).

Counter-example: a "neon color palette" library would not be justified. We can write a 5-line color helper. Adding a dependency for it is pure laziness.

## The audit trail

When you add a dependency, you must add an entry to the **dependency log** at the bottom of this file. The entry has four fields:

- **Name and version.** The exact package and the version pinned in `package.json`.
- **What it replaces.** What we would have written ourselves if we hadn't added it.
- **Why it's worth it.** One sentence on why writing it ourselves was the wrong call.
- **The fallback plan.** How we'd remove it if we needed to. "Replace with a 50-line custom implementation" or "Switch to library X" or "Stop supporting feature Y."

Adding a dependency without updating this log is grounds for reverting the change in code review. The discipline is the point.

## Banned categories

Some categories of dependencies are **never** added to GRID. No exceptions.

| Category | Why |
|---|---|
| Telemetry / analytics SDKs | GRID has no operator and no central infrastructure. Nothing reports home. |
| Update checkers | The user invoked `npx grid` themselves; that's the update mechanism. No background checks. |
| Crash reporters | Crashes are reported to the user's terminal, not to a remote service. |
| Authentication SDKs | GRID has no accounts and no authentication. |
| ORM / database libraries | GRID has no database. |
| Frontend frameworks (React, Vue, Svelte) | GRID is a terminal app. No DOM. |
| Build-time CSS / styling tools | No CSS in a terminal. |
| Polyfills for Node features the project's minimum Node version already supports | Pin the Node version instead. |
| AI / LLM SDKs in the GRID core | The forge command may use an LLM, but the core game cannot depend on any LLM. The forge integration is optional and uses the user's own API key directly. |
| Anything that requires running a daemon or background service alongside GRID | GRID is a single self-contained command. |
| Anything with a license other than MIT, ISC, BSD, Apache 2.0, or 0BSD | License compatibility is not negotiable. GPL/LGPL/AGPL dependencies are forbidden. |

If you're unsure whether a dependency falls into a banned category, **ask before adding**.

## Lockfile discipline

- The `package-lock.json` is committed and is the source of truth for installed versions. Always commit it after `npm install`.
- Never delete the lockfile to "fix" a dependency issue. Investigate the issue and fix it properly.
- Use `npm ci` in CI, not `npm install`. `npm ci` enforces the lockfile and fails if it's out of sync.
- Pin direct dependencies to exact versions in `package.json` (`"trystero": "1.2.3"`, not `"^1.2.3"` or `"~1.2.3"`). Indirect dependencies are managed by the lockfile.

The reasoning: GRID is a published npm package that runs on user machines. A semver-bumped dependency that changes behavior subtly will desync the determinism CI test on the day after the dependency author publishes the bump. Pinning prevents this. Upgrades are explicit and tested.

## Update policy

- **Direct dependencies are reviewed quarterly**, or when a CVE is disclosed against one of them. Updates are tested against the determinism CI before merging.
- **Indirect dependencies are accepted via lockfile updates** when they don't affect direct-dependency versions.
- **A dependency that becomes unmaintained** (no commits in 12+ months, no response to issues) is a candidate for replacement or removal. Add a note to the dependency log when you notice this and revisit at the next quarterly review.
- **A dependency that introduces a banned-category capability** in a new version (e.g., adds telemetry) must be replaced or downgraded. This is a breaking change for GRID.

## Dev dependencies

The same rules apply to `devDependencies` as to runtime dependencies, with one relaxation: dev dependencies that don't ship to users (test runners, linters, type-checkers) have a slightly lower bar because they don't affect the production package size or runtime behavior. They still appear in the audit trail.

Banned for dev dependencies, same as runtime: telemetry, license-incompatible packages, anything that requires a background service.

## Approximate dependency budget for v0.1

A rough sense of how many dependencies GRID v0.1 should have. These numbers are targets, not hard caps.

- **Direct runtime dependencies: 3–6.** Trystero, possibly a TUI library (Ink or blessed), possibly a tiny CLI argument parser. That's it. Everything else uses Node built-ins or is vendored.
- **Direct dev dependencies: 5–10.** TypeScript, the test runner (or `node --test`), the linter, fast-check, the formatter. Maybe a CI helper.
- **Indirect dependencies (transitively): aim for under 200.** This is mostly determined by the direct dependencies' own dep trees. If a candidate dependency drags in 500 transitive packages, that's a strong signal to write it yourself.

A v0.1 GRID with 1,000+ transitive dependencies would be a sign that something has gone wrong with the dependency discipline.

## The dependency log

Every dependency listed in `package.json` has an entry here. The entry is added in the same commit that adds the dependency.

### Runtime dependencies

> *No dependencies have been added yet. The first entry will be Trystero when v0.1 stage 5 begins.*

(Format for future entries:)

#### `<package-name>` `<version>`
- **What it replaces:** [what we'd write ourselves]
- **Why it's worth it:** [one sentence]
- **Fallback plan:** [how to remove it if needed]

### Dev dependencies

> *No dependencies have been added yet.*

## Auditing dependencies

Once a quarter, run:

```bash
npm audit
npm outdated
```

Triage the results:

- **Critical / high CVEs:** patch immediately (within a day).
- **Moderate CVEs:** patch within a week, or document why we're choosing not to.
- **Outdated packages:** upgrade if there's a clear improvement, leave pinned otherwise. Pinning is a feature, not a bug.

A quarterly review is recorded in this file with a one-line entry under "Audit history."

### Audit history

> *No audits yet. First audit will happen after v0.1 ships.*
