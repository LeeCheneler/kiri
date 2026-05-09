# Kiri — Design Notes

> *Kiri* (キリト) — Short for Kirito, the protagonist of *Sword Art Online*. Always wanted to call my dog Kiri.

## Concept

A local-first, git-based workflow orchestrator for personal automation. Scripts and AI workflows triggered by cron, manual invocation, or AI agents via MCP. A feed UI streams activity, a todo list captures gated proposals, and a global pause provides a panic button. Single user (me), running while the app is active.

Differentiation against Windmill, Kestra, n8n, Inngest et al. is two-fold:

- **MCP-first** — AI agents can list, invoke, configure, and inspect workflows as a primary interaction model, not a bolt-on
- **Feed-first UI** — activity stream as the primary surface, not a node-graph canvas

## Core principles

- **App-active scope.** Everything runs while the app is open. No daemons, no launchd, no overnight execution. Sleep/wake is not our problem.
- **Single user.** No auth, no multi-tenancy, no scaling.
- **Git as source of truth.** Workflow definitions, prompts, and scripts live in a git repo.
- **Linear pipelines only.** No branches, no conditionals, no fan-out/fan-in. `script → ai → script` covers most real cases.
- **Everything is a workflow.** A workflow is N≥1 steps. Single-step workflows wrap "just run a script" cases. Cron triggers workflows. Todos invoke workflows. MCP exposes workflows. Manual menu items are workflows. One concept, uniform treatment everywhere.

## Architecture

### Workflow definition

YAML files validated against a Zod schema. No custom DSL.

```yaml
name: pr-review
schedule: "*/15 * * * *"   # optional cron expression
gating: auto               # or "propose"
steps:
  - use: fetch-pr           # script bundle: scripts/fetch-pr/run.sh
    env:
      PR_NUMBER: "42"
  - use: claude-code        # script bundle: scripts/claude-code/run.sh (shipped by `kiri init`)
    env:
      PROMPT_FILE: prompts/pr-review.tpl
      MAX_TURNS: "8"
      ALLOWED_TOOLS: "Read,Glob,Grep"
  - sh: |                   # inline shell — sugar for trivial steps
      echo "review complete"
      date
```

A step is one of two shapes:

- `{ use: <name>, env?: { ... } }` — references a **script bundle** at `scripts/<name>/run.sh`. The bundle is a folder containing at minimum `run.sh` plus any sidecar files it needs (prompt files, generated settings, README documenting the bundle's env-var contract).
- `{ sh: <string>, env?: { ... } }` — inline shell script, run via `sh -c`. Sugar for one-shots that don't deserve their own bundle. Multi-line via YAML's `|` block scalar.

`env:` is a flat string-to-string map, passed verbatim to the bundle (or inline shell). Each bundle defines its own contract for what keys it expects; kiri doesn't validate config contents. Kiri's own scoped vars (`KIRI_RUN_ID`, `KIRI_STEP_INDEX`, `KIRI_META_FILE`, `KIRI_REPO_ROOT`) and OS essentials (`PATH`, `HOME`, `USER`, `LOGNAME`) are applied **after** user env at spawn time, so a workflow can't override them. The `KIRI_` prefix is reserved — workflow `env:` keys starting with `KIRI_` are rejected at load time.

This single primitive — the script bundle — supports every runtime kiri will ever care about. `kiri init` ships a `scripts/claude-code/` starter; LM Studio support is `cp -r scripts/claude-code scripts/lm-studio` and editing the script. Kiri itself stays runtime-blind: it spawns `run.sh`, captures the envelope, reads `KIRI_META_FILE`, and stays out of the way.

Rationale for YAML over TS: workflow files live in arbitrary user repos, but kiri ships as a single Bun-compiled binary. Resolving a TS `import { defineWorkflow } from "kiri"` from those repos would require both a Bun plugin baked into the binary to intercept the import *and* generated `.d.ts` files dropped into each repo for IDE support — both maintenance costs that compound forever. YAML is pure data, validated at load time, and a JSON schema can be published alongside the binary for editor LSP integration with no per-repo footprint.

### Standard step envelope

Every step returns the same shape. Designed in early — painful to retrofit.

```ts
{
  status: "ok" | "failed",
  output: unknown,         // becomes the next step's input
  error?: { message, stack? },
  traces: { stdout, stderr, durations, ... },
  meta?: Record<string, unknown>  // arbitrary key-value populated by the step
}
```

Full I/O captured at every step. Linked from the corresponding feed entry for debugging and replay.

`meta` is populated by the step writing JSON to `KIRI_META_FILE` (path provided by kiri, under per-run scratch). Kiri reads the file after the step exits and folds it into the envelope. The channel is generic — any step kind can emit whatever keys are useful. Conventional keys (`cost_usd`, `tokens_in`, `tokens_out`, `model`) get promoted to feed-entry headers by the UI; everything else renders as a key-value list in the expanded view.

### Execution semantics

- **Concurrency:** global default of 1 in-flight workflow run. Per-workflow override added later only if needed.
- **Errors:** step fails → workflow halts → run marked failed → feed entry shows error → manual re-run from the feed entry.
- **No auto-retry, no DLQ, no fan-out** in v1.

### Triggers

Three only:

- **Cron** — in-process tick loop while the app is active.
- **Manual** — invoked from the UI (menu, feed, todo).
- **MCP** — invoked by AI agents via the orchestrator's MCP server.

No file watches, webhooks, or inbox polling. Polling-via-cron-workflow handles everything that shape.

### State storage

State lives in three tiers, by what kind of state it is:

- **In git** — workflow definitions (`.yaml` files), script bundles (`scripts/<name>/`), prompt files, sandbox profiles. Everything that benefits from review and version history.
- **In SQLite** — runtime state: runs, todos, schedules, app state (paused/running, in-flight counter), MCP audit log, run metadata + envelopes. Single file in the data dir, queryable, indexed, transactional. **bun:sqlite** as the driver (synchronous, fast, statically linked into the Bun runtime), **Drizzle** for schema and migrations.
- **On disk (data dir)** — large blob payloads referenced by path from SQLite rows: full CC transcripts, big stdout dumps, anything that'd bloat the DB. Same pattern CI systems use to keep the DB lean.

Pragmatic v1 simplification: skip the disk-blob split initially. Put traces straight into SQLite TEXT columns. Move to disk-backed blobs only when a "last 50 runs" feed query starts dragging on trace payloads — probably won't for months.

### Workflow registry & run snapshots

Workflow definitions are YAML files in `workflows/` — the single source of truth, with no SQL representation. There is **no `workflows` table**. On startup (and on file change in dev) the loader scans the directory, parses each file, validates it against the workflow Zod schema, and hydrates an in-memory registry; runs reference workflows by name only.

When a run starts, the executor captures a **snapshot** of everything that produced it:

- The resolved workflow definition (name, steps, gating, schedule) onto the run row.
- Per-step *materials* — the actual bytes that drove the step — onto the per-step row. For `use:` steps that's the entire bundle directory contents (`run.sh` + any sidecar files). For `sh:` steps that's the inline shell text.

This means feed entries always show the exact code that ran, not whatever the file says now; diffing two runs of the same workflow shows what changed between them; and renaming or deleting a workflow leaves old runs intact under their original name (UI shows a "(deleted)" badge).

Re-running an old run uses the *current* definition, not the snapshot. Replay-from-snapshot is out of scope for v1.

## Todo system

Workflows can produce todos. A todo is a proposed workflow invocation waiting for approval (or auto-execution if its workflow is configured `gating: "auto"`).

- **Deduplication.** The producing script declares the dedup key. Recommended shape for repo-scoped tasks: `{repo}/{pr_id}/{head_sha}` — new commits produce a new todo and the old one auto-archives, preserving timeline integrity.
- **Gating.** Per-workflow toggle: `auto` (run immediately, post results to feed) or `propose` (sit in todo list, wait for human approval).
- **Lifecycle.** Pending → approved (or auto) → in-flight → completed/failed → archived. Visible in the right-rail todo view with linked feed entries.

## AI integration

### Claude Code via the `claude-code` bundle

Kiri integrates with Claude Code by shipping a `scripts/claude-code/` bundle via `kiri init` — a starter the user owns once written. Kiri itself has no CC-specific code; the bundle does the spawning, config translation, transcript parsing, and meta emission. Spawning CC's CLI directly keeps Max subscription billing in play — the Agent SDK is API-billed only and not on the table for this personal tool.

Bundle layout shipped by `kiri init`:

```
scripts/claude-code/
  run.sh         # spawns `claude` CLI, parses transcript, writes KIRI_META_FILE
  README.md      # documents the env-var contract: PROMPT_FILE, MAX_TURNS, ALLOWED_TOOLS, MODEL
```

Workflow usage:

```yaml
- use: claude-code
  env:
    PROMPT_FILE: prompts/pr-review.tpl
    MAX_TURNS: "8"
    ALLOWED_TOOLS: "Read,Glob,Grep,Bash(gh pr view:*)"
    MODEL: opus              # optional
```

What `run.sh` does at spawn time:

- Reads its env-var contract (`PROMPT_FILE`, `MAX_TURNS`, `ALLOWED_TOOLS`, `MODEL`).
- Synthesises a `.claude/settings.json` in per-run scratch from `ALLOWED_TOOLS`, sets `CLAUDE_CONFIG_DIR` to that dir.
- Loads the prompt from `PROMPT_FILE` (resolved against `KIRI_REPO_ROOT`) and **prepends the allowlist as positive framing** ("You have access to: …. If you need anything else, end the session with a final message describing what you needed and why.") so the agent doesn't burn turns on denied tools.
- Spawns `claude -p "$PROMPT" --max-turns "$MAX_TURNS" --output-format json`, capturing the session ID.
- Locates the JSONL transcript at `~/.claude/projects/<hash>/<session>.jsonl`, parses tokens / model / cost, and writes them as JSON to `$KIRI_META_FILE` so they land on the envelope's `meta`.

The bundle is plain bash — readable, modifiable, replaceable. Adding LM Studio support is `cp -r scripts/claude-code scripts/lm-studio` and editing. Kiri ships the starter, the user owns it from there.

### Output validation (for LLM steps producing structured output)

Three tiers, in order:

1. Use structured output / tool use at the API level. Kills ~95% of "wrapped in backticks" failures.
2. Validate against Zod schema. On failure, one-shot retry with the validation error fed back into the prompt.
3. *Optional* dedicated cleanup model — constrained to format-level repairs only. Stripping backticks: safe. Reshaping prose into fields: not safe.

### Cost tracking

The shipped `claude-code` bundle is one consumer of the generic `meta` channel. After each invocation it parses the CC transcript and writes `{ cost_usd, tokens_in, tokens_out, model }` to `$KIRI_META_FILE`. The UI promotes those conventional keys to feed-entry headers — cost surfaces directly in the feed, not buried in a settings page.

ccusage's parsing approach is the reference for transcript-derived numbers. Future bundles (`scripts/lm-studio/`, `scripts/ollama/`) populate the same conventional keys when they have the data; the UI doesn't care which bundle produced them, and kiri carries no runtime-specific cost-shape knowledge.

### Permissions philosophy

Static policy per step via `ALLOWED_TOOLS` in the workflow's `env:`. The `claude-code` bundle's `run.sh` synthesises a `.claude/settings.json` at spawn time and points CC at it — so the workflow YAML is the load-bearing source of permission truth, no hand-edited settings files anywhere in the user's repo. **No runtime hooks for v1.** Hooks are reserved for if/when dynamic per-call policy is wanted (token budget caps, mid-session escalation, tool-granular propose-to-approve).

For workflows using broad `Bash(*)` permissions, the load-bearing defence is the static `ALLOWED_TOOLS` allowlist on the step itself, plus the user's own claude config. Kiri does not wrap steps in a kernel sandbox: bundles are user-authored scripts in the user's own repo, with the same trust posture as any shell script they'd run themselves. If a bundle-install mechanism is ever added (a marketplace, `kiri install <bundle>`, etc.), revisit — the trust boundary changes at that point.

## UI

Three regions:

- **Center: feed.** Streaming activity log. Filterable, scoped, tab-able. Each entry has a condensed view (produced by a summariser step — leaf only, no recursion) with an expandable full view that includes traces and meta.
- **Right rail: todos.** Pending proposals + active items. Approve/reject inline.
- **Top right: global pause.** Halts new invocations. Modifier to also kill in-flight runs.

Cost visibility lives in the feed itself, not a separate dashboard.

## MCP server surface

Initial sketch:

- `list_workflows` — names, schemas, gating
- `run_workflow(name, inputs)` — invoke
- `get_run(id)` — full envelope + traces
- `list_runs(filter)` — feed-shaped query
- `create_workflow / edit_workflow` — write workflow definitions to git
- `approve_todo / reject_todo` — act on the todo list
- `pause / resume` — global control

The same surface a human uses is callable by an MCP client. That's what makes the "AI agent operates the system" framing real.

## Application stack

The orchestrator is a single Node process serving both the engine and the UI. The user "uses the app" by visiting a local URL in their browser; the process keeps running regardless of whether that browser tab is open.

### Stack

- **Bun** — runtime. TypeScript runs natively (no separate compile step), `bun:sqlite` is statically linked (no native-module headache), and `bun build --compile` produces a single-file macOS binary — the release artifact for distribution. One toolchain for install, test, run, and build.
- **Hono** — HTTP server, SSE streams, MCP transport. Runtime-agnostic by design but pairs cleanly with Bun via `Bun.serve`. The Hono process *is* the orchestrator daemon: runs the cron tick loop, executes workflows, hosts the MCP server, serves the UI bundle. One process, clear ownership.
- **Vite + React** — UI bundle, served by Hono. No SSR, no framework magic — just a SPA window into the daemon. TanStack Router or React Router for routing.
- **SSE** for live feed updates. One-way (server → client), browsers handle reconnection natively, Hono has `streamSSE` built in. WebSockets reserved for if/when bidirectional streaming is actually needed.
- **bun:sqlite + Drizzle** for state (see *State storage* under Architecture). Drizzle's `drizzle-orm/bun-sqlite` adapter; schema and migrations identical to a Node + better-sqlite3 setup.

No Next.js, no HonoX, no full-stack framework — explicit choice to keep UI and daemon as separate layers communicating over HTTP/SSE.

### Launch model & data dir

Kiri is a CLI launched from the cwd of whichever directory you want to run workflows against. The tool is global; the directory is the workspace. Same shape as `vite`, `next dev`, `drizzle-kit` — switching projects is `cd && kiri`. There is no global cross-repo store. Workflow definitions are expected to live under git, but kiri itself doesn't enforce that — the user owns versioning their own definitions.

Repo-scoped runtime state lives in `.kiri/` at the repo root, gitignored:

```
<repo-root>/
  workflows/                  # YAML workflow definitions (in git)
  scripts/                    # script bundles (in git)
    claude-code/              # `kiri init` ships this; user owns from then on
      run.sh
      README.md
    <other-bundles>/...
  prompts/                    # CC prompt templates (in git, convention only — any path works)
  .kiri/                      # gitignored — repo-scoped runtime state
    state.db                  # SQLite
    runs/<id>/                # per-run scratch dirs
```

Startup scaffolds `workflows/` and `.kiri/` at cwd if either is missing, then opens and migrates the state DB. No gates — a fresh `cd && kiri` just works, and the empty `workflows/` itself signals "nothing defined yet."

### Process model

Closing the browser tab does not kill the orchestrator. Killing the Hono process does. Matches the app-active constraint: orchestrator runs while the user is "at the keyboard" (i.e. has the daemon up), and stops cleanly when they're done. No background daemon, no launchd entry.

### Local URL & HTTPS

Canonical entry point is `https://local.kiri.build` — a tiny hand-maintained HTML shell hosted on Cloudflare Pages. The shell loads the locally-running kiri's app bundle from `http://127.0.0.1:4242/app.js` + `/app.css` (cross-origin, with `crossorigin="anonymous"`) and the bundle calls the API on the same local origin. Pages auto-provisions the cert on the custom domain; no embedded ACME, no DNS-01 challenge, no on-host TLS termination.

The split is what makes this trivial: Pages serves a single static shell file; kiri itself is unchanged HTTP on `127.0.0.1`. CORS allow-list on the kiri server permits `https://local.kiri.build` (plus `http://127.0.0.1:4242` and `http://localhost:4242` as fallbacks), and the shell's bundle paths are stable (`app.js`, `app.css`) so the shell needs no rebuild when kiri updates.

Browser caveat: Safari and Brave block HTTP-localhost subresource loads from an HTTPS page (mixed-content / private-network policies). On those browsers the fallback is the direct `http://localhost:4242` URL. A local-served HTTPS recipe (mkcert) is a possible future follow-on but not built.

### Future: native shell

Web-first for v1. If/when native system notifications, menu bar presence, or a real "app icon" become worth the effort, wrap the same Hono+React+Vite app in **Tauri 2** — minimal change to the codebase, native integration where it matters. Not a v1 commitment, just a path that stays open.

## Security

Script execution is the central capability of this system, which means security is not a bolt-on layer — it's a design constraint that shapes every surface. The threat model assumes:

- Workflow inputs (especially via MCP) are untrusted data.
- Polled external content (PR titles, issue bodies, file contents from third-party repos) is untrusted.
- AI agents may attempt actions outside their intended scope due to prompt injection, misalignment, or simple error.
- The local machine is otherwise trusted (this is a personal tool on the user's own laptop).

### Trust boundaries

- **Workflow definitions, prompts, and scripts** (files in git) are *trusted*. They are reviewed and version-controlled.
- **Workflow inputs** at runtime are *untrusted*. They come from MCP clients, external polling, or upstream step outputs that may have processed third-party data.
- **AI outputs** are *untrusted*. Even from a tightly-scoped agent, output is data, not commands. When it flows downstream as input to another step, it must be treated as untrusted input.

### Script execution

- **No shell interpolation of inputs.** Workflow inputs are passed via env vars or argv arrays, never spliced into shell command strings. The orchestrator constructs argument lists, the OS handles them, no shell parsing of user-controlled strings.
- **Per-step working directory.** Each workflow run gets a scratch directory; the step's cwd is set there, not the user's home or the orchestrator repo.
- **Per-step env scope.** Steps only see env vars from the step's `env:` block plus a small kiri-controlled set (`KIRI_RUN_ID`, `KIRI_STEP_INDEX`, `KIRI_META_FILE`, `KIRI_REPO_ROOT`) and the OS essentials (`PATH`, `HOME`, `USER`, `LOGNAME`). No other parent-process env leaks through.
- **Env precedence at spawn.** User-declared `env:` is applied first; kiri- and OS-controlled vars overwrite on key collision. A workflow can't redirect `PATH` to inject a malicious binary, can't rebind `KIRI_META_FILE` to escape capture, can't shadow `KIRI_RUN_ID` to confuse run identity.
- **Reserved namespace.** `env:` keys starting with `KIRI_` are rejected at workflow load time as a schema error. Typos and accidental collisions surface as load failures, not silent overwrites at spawn.
- **Resource limits.** ulimits on CPU time, memory, file descriptors, and disk writes. A runaway script halts cleanly rather than degrading the system.
- **No kernel sandbox.** Bundles run with the user's permissions. The trust posture is "scripts you authored or pasted into your own repo, same as any shell script you'd run yourself" — sandbox-wrapping every step is cost without protection in that model. The defence here is `ALLOWED_TOOLS` on the step plus reading the bundle before you use it.

### MCP server

- **Localhost-only or Unix socket.** No public listen address, ever. Unix socket preferred to eliminate CSRF risk entirely.
- **Bearer token auth.** Even local clients authenticate. Token lives in `~/.local/share/orchestrator/auth-token` with mode 600.
- **Write tools require confirmation.** `create_workflow`, `edit_workflow`, `approve_todo`, `pause/resume` either require an interactive confirmation in the UI or a separately-scoped confirmation token. Read-only tools don't.
- **Audit log.** Every MCP call recorded with timestamp, client identity (where available), tool name, and arguments. Append-only, surfaced in the feed.

### AI integration

- **Assume prompt injection.** PR bodies, issue text, file contents reaching an agent's prompt may attempt to redirect its behaviour. The permission allowlist is the load-bearing defence — even a fully compromised agent can only do what the step's `ALLOWED_TOOLS` declares. Prompt-level mitigations (system prompt framing) help but aren't relied on as primary defence.
- **Conservative allowlists.** Adding `Bash(*)` to any step's allowlist requires a deliberate decision, never a quick fix to "make it work."

### Secrets

- **No secrets in workflow definitions.** Definitions are git-tracked. Secrets stay outside the repo, mode 600, referenced by name from the workflow.
- **No secrets in feed entries or traces.** Output rendering scrubs known secret patterns (tokens, AWS keys, etc.) before display and persistence.

### UI

- **All script and AI output is treated as untrusted.** Render via a sanitiser; never `dangerouslySetInnerHTML`. Markdown rendering uses a hardened parser with no raw-HTML pass-through.
- **External links sandboxed.** `noopener noreferrer` on all outbound. No `javascript:` URLs.

### Operational hygiene

- **Orchestrator runs as the user.** No setuid, no elevated privileges. If a workflow needs more, it asks explicitly and the user approves once.
- **Definition repo treated as source code.** Reviewed PRs, signed commits where possible, no auto-merging of definition changes.

## Out of scope (v1)

Non-goals to resist scope creep:

- Branching, conditionals, fan-out/fan-in
- Auto-retry, DLQ
- File watches, webhooks, inbox polling
- Multi-user, auth, sharing
- Tool-granular propose-to-approve (workflow-level only)
- Dynamic per-call permission policy (static per step only)
- Persistent execution across app restarts (graceful halt on close, manual re-run on reopen)
- Custom DSL for workflows

## Phased build

Sequenced for fastest path to dogfooding, then layering capability outward. Each phase a usable artifact. Detailed work items per milestone live in `milestones.md`.

1. **Spine** (M0). Workflow runner that executes a YAML-defined linear pipeline of script steps. Standard envelope. Traces captured. Run history persisted to SQLite via Drizzle. Feed UI renders run history; reload to refresh.
2. **Step schema migration** (M1). Move workflow YAML from `nodes:`/`kind:` to `steps:` with `use:` (bundle reference) or `sh:` (inline shell). Add `env:` map per step with the precedence and reserved-namespace rules. Bundle resolver: `use: <name>` → `scripts/<name>/run.sh`. Re-home the existing repo's scripts into the bundle layout.
3. **`claude-code` bundle starter** (M2). `kiri init` writes `scripts/claude-code/{run.sh, README.md}` — a working CC runner that translates `env:` keys to CC flags, synthesises `.claude/settings.json`, spawns `claude`, captures the session. No cost capture yet — that wires in alongside M6's meta channel.
4. **Security baseline** (M3). Bind to localhost only and require `X-Kiri-Client` header on state-changing endpoints — together they shut down cross-origin attacks from other browser tabs. No kernel sandboxing of step execution: bundles are user-authored, trusted as such.
5. **Cron triggers** (M4). In-process tick loop, schedule field on workflows.
6. **Todo list + gating** (M5). Dedup keys, propose vs auto, right-rail UI.
7. **Generic step meta** (M6). `KIRI_META_FILE` channel, DB storage, UI rendering. The `claude-code` bundle gets updated to populate `cost_usd` and tokens; UI promotes conventional keys to feed-entry headers.
8. **Polish** (M7). SSE feed updates, filtering, summariser step, global pause.
9. **MCP read surface** (M8). `list_workflows`, `run_workflow`, `get_run`, `list_runs`. Agent drives the system end-to-end.

## Open questions

- **Trace retention policy.** How long do verbose traces and CC transcripts stay in SQLite before pruning? Size-cap, time-cap, or both? Decision triggers the disk-blob split.
- **Summariser model choice.** Haiku via API for speed/cost, or a CC session for consistency with the rest of the agent stack? Probably Haiku.
- **Secret store mechanism.** Mode-600 env files in a known dir, OS keychain integration, or 1Password CLI integration? Trade-off: friction vs ergonomics.

## Prior art (reference, not imitation)

- **Windmill** — closest "shape" minus MCP/feed
- **Kestra** — declarative + git sync, more CI-flavoured
- **n8n** — recently added MCP, but graph-first UX
- **Rivet** — visual AI flows in Electron
- **Inngest / Trigger.dev** — event-driven dev primitives, cloud-oriented
- **Huginn** — old Ruby agents project that originated the "feed of events" model
-
