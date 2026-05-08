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
- **Git as source of truth.** Workflow definitions, templates, and config live in a git repo.
- **Linear pipelines only.** No branches, no conditionals, no fan-out/fan-in. `script → ai → script` covers most real cases.
- **Everything is a workflow.** A workflow is N≥1 nodes. Single-node workflows wrap "just run a script" cases. Cron triggers workflows. Todos invoke workflows. MCP exposes workflows. Manual menu items are workflows. One concept, uniform treatment everywhere.

## Architecture

### Workflow definition

YAML files validated against a Zod schema. No custom DSL.

```yaml
name: pr-review
schedule: "*/15 * * * *"   # optional cron expression
nodes:
  - kind: script
    path: ...
  - kind: agent
    template: claude-code-review
    config: { ... }
  - kind: script
    path: ...
gating: auto               # or "propose"
```

Rationale for YAML over TS: workflow files live in arbitrary user repos, but kiri ships as a single Bun-compiled binary. Resolving a TS `import { defineWorkflow } from "kiri"` from those repos would require both a Bun plugin baked into the binary to intercept the import *and* generated `.d.ts` files dropped into each repo for IDE support — both maintenance costs that compound forever. YAML is pure data, validated at load time, and a JSON schema can be published alongside the binary for editor LSP integration with no per-repo footprint.

### Standard node envelope

Every node returns the same shape. Designed in early — painful to retrofit.

```ts
{
  status: "ok" | "failed",
  output: unknown,         // matches the next node's input schema
  error?: { message, stack? },
  traces: { stdout, stderr, durations, ... },
  usage?: { tokens_in, tokens_out, cost_usd, model }
}
```

Full I/O captured at every step. Linked from the corresponding feed entry for debugging and replay.

### Execution semantics

- **Concurrency:** global default of 1 in-flight workflow run. Per-workflow override added later only if needed.
- **Errors:** node fails → workflow halts → run marked failed → feed entry shows error → manual re-run from the feed entry.
- **No auto-retry, no DLQ, no fan-out** in v1.

### Triggers

Three only:

- **Cron** — in-process tick loop while the app is active.
- **Manual** — invoked from the UI (menu, feed, todo).
- **MCP** — invoked by AI agents via the orchestrator's MCP server.

No file watches, webhooks, or inbox polling. Polling-via-cron-workflow handles everything that shape.

### State storage

State lives in three tiers, by what kind of state it is:

- **In git** — workflow definitions (`.yaml` files), template scripts, per-template `.claude/settings.json`, Seatbelt profiles. Everything that benefits from review and version history.
- **In SQLite** — runtime state: runs, todos, schedules, app state (paused/running, in-flight counter), MCP audit log, run metadata + envelopes. Single file in the data dir, queryable, indexed, transactional. **bun:sqlite** as the driver (synchronous, fast, statically linked into the Bun runtime), **Drizzle** for schema and migrations.
- **On disk (data dir)** — large blob payloads referenced by path from SQLite rows: full CC transcripts, big stdout dumps, anything that'd bloat the DB. Same pattern CI systems use to keep the DB lean.

Pragmatic v1 simplification: skip the disk-blob split initially. Put traces straight into SQLite TEXT columns. Move to disk-backed blobs only when a "last 50 runs" feed query starts dragging on trace payloads — probably won't for months.

### Workflow registry & run snapshots

Workflow definitions are YAML files in `workflows/` — the single source of truth, with no SQL representation. There is **no `workflows` table**. On startup (and on file change in dev) the loader scans the directory, parses each file, validates it against the workflow Zod schema, and hydrates an in-memory registry; runs reference workflows by name only.

When a run starts, the executor captures a **snapshot** of everything that produced it:

- The resolved workflow definition (name, schemas, node list, gating, schedule) onto the `runs` row.
- Per-node *materials* — the actual bytes read off disk for each node — onto the `run_nodes` rows. For script nodes that's the script source. Later, for agent nodes (M1+), it's the prompt template, `.claude/settings.json`, and the sandbox profile.

This means feed entries always show the exact code that ran, not whatever the file says now; diffing two runs of the same workflow shows what changed between them; and renaming or deleting a workflow leaves old runs intact under their original name (UI shows a "(deleted)" badge).

Re-running an old run uses the *current* definition, not the snapshot. Replay-from-snapshot is out of scope for v1.

## Todo system

Workflows can produce todos. A todo is a proposed workflow invocation waiting for approval (or auto-execution if its workflow is configured `gating: "auto"`).

- **Deduplication.** The producing script declares the dedup key. Recommended shape for repo-scoped tasks: `{repo}/{pr_id}/{head_sha}` — new commits produce a new todo and the old one auto-archives, preserving timeline integrity.
- **Gating.** Per-workflow toggle: `auto` (run immediately, post results to feed) or `propose` (sit in todo list, wait for human approval).
- **Lifecycle.** Pending → approved (or auto) → in-flight → completed/failed → archived. Visible in the right-rail todo view with linked feed entries.

## AI integration

### Claude Code via CLI

The orchestrator spawns `claude` CLI for agent nodes. This keeps Max subscription billing in play — the Agent SDK is API-billed only and not on the table for this personal tool.

Per-template directory layout:

```
templates/
  pr-review/
    .claude/settings.json    # Read, Glob, Grep, Bash(gh pr view *)
    prompt.tpl
    run.sh
  patch-deps/
    .claude/settings.json    # Read, Edit, Bash(npm:*), Bash(pnpm:*)
    prompt.tpl
    run.sh
```

Each invocation:

```bash
CLAUDE_CONFIG_DIR=$TEMPLATE_DIR claude -p "$PROMPT" \
  --allowedTools "..." \
  --max-turns N \
  --output-format json
```

The allowlist is **also injected into the prompt** so the agent doesn't burn turns on denied tools. Frame positively: "You have access to: …. If you need anything else, end the session with a final message describing what you needed and why."

### Output validation (for LLM nodes producing structured output)

Three tiers, in order:

1. Use structured output / tool use at the API level. Kills ~95% of "wrapped in backticks" failures.
2. Validate against Zod schema. On failure, one-shot retry with the validation error fed back into the prompt.
3. *Optional* dedicated cleanup model — constrained to format-level repairs only. Stripping backticks: safe. Reshaping prose into fields: not safe.

### Cost tracking

CC writes JSONL transcripts to `~/.claude/projects/<hash>/`. Each agent template script:

- Captures the session ID at start
- Reads the transcript at end
- Returns `usage` in the standard envelope

ccusage already does this parsing — borrow its approach. Per-workflow cost then surfaces directly in the feed, not buried in a settings page.

### Permissions philosophy

Static policy per template via `.claude/settings.json`. **No runtime hooks for v1.** Hooks are reserved for if/when dynamic per-call policy is wanted (token budget caps, mid-session escalation, tool-granular propose-to-approve). Directory-per-template scoped settings are the spine.

For workflows using broad `Bash(*)` permissions, layer macOS Seatbelt sandboxing as a kernel-level backstop.

## UI

Three regions:

- **Center: feed.** Streaming activity log. Filterable, scoped, tab-able. Each entry has a condensed view (produced by a summariser workflow node — leaf only, no recursion) with an expandable full view that includes traces and usage.
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
  workflows/        # YAML workflow definitions (in git)
  templates/        # per-template dirs, M1+ (in git)
  .kiri/            # gitignored — repo-scoped runtime state
    state.db        # SQLite
    runs/<id>/      # per-run scratch dirs
```

Startup scaffolds `workflows/` and `.kiri/` at cwd if either is missing, then opens and migrates the state DB. No gates — a fresh `cd && kiri` just works, and the empty `workflows/` itself signals "nothing defined yet."

### Process model

Closing the browser tab does not kill the orchestrator. Killing the Hono process does. Matches the app-active constraint: orchestrator runs while the user is "at the keyboard" (i.e. has the daemon up), and stops cleanly when they're done. No background daemon, no launchd entry.

### Local URL & HTTPS

Hosted at `kiri.cheneler.me` — DNS A record points to `127.0.0.1`, real Let's Encrypt cert via DNS-01 challenge. Real HTTPS on localhost, bookmarkable, consistent across devices on the LAN. No new domain purchase needed; subdomain on an existing personal domain handles it cleanly.

### Future: native shell

Web-first for v1. If/when native system notifications, menu bar presence, or a real "app icon" become worth the effort, wrap the same Hono+React+Vite app in **Tauri 2** — minimal change to the codebase, native integration where it matters. Not a v1 commitment, just a path that stays open.

## Security

Script execution is the central capability of this system, which means security is not a bolt-on layer — it's a design constraint that shapes every surface. The threat model assumes:

- Workflow inputs (especially via MCP) are untrusted data.
- Polled external content (PR titles, issue bodies, file contents from third-party repos) is untrusted.
- AI agents may attempt actions outside their intended scope due to prompt injection, misalignment, or simple error.
- The local machine is otherwise trusted (this is a personal tool on the user's own laptop).

### Trust boundaries

- **Template definitions** (TS files in git) are *trusted*. They are reviewed and version-controlled.
- **Workflow inputs** at runtime are *untrusted*. They come from MCP clients, external polling, or upstream node outputs that may have processed third-party data.
- **AI outputs** are *untrusted*. Even from a tightly-scoped agent, output is data, not commands. When it flows downstream as input to another node, it must be treated as untrusted input.

### Script execution

- **No shell interpolation of inputs.** Workflow inputs are passed via env vars or argv arrays, never spliced into shell command strings. The orchestrator constructs argument lists, the OS handles them, no shell parsing of user-controlled strings.
- **Per-template working directory.** Each workflow run gets a scratch directory; the script's cwd is set there, not the user's home or the orchestrator repo.
- **Per-template env scope.** Scripts only see env vars explicitly declared by the template. No leaking of orchestrator state or unrelated secrets.
- **Resource limits.** ulimits on CPU time, memory, file descriptors, and disk writes. A runaway script halts cleanly rather than degrading the system.
- **Seatbelt sandbox** applied to all script execution by default — not just to CC's `Bash(*)` operations. The macOS sandbox restricts filesystem and network reach to what the template explicitly declares.

### MCP server

- **Localhost-only or Unix socket.** No public listen address, ever. Unix socket preferred to eliminate CSRF risk entirely.
- **Bearer token auth.** Even local clients authenticate. Token lives in `~/.local/share/orchestrator/auth-token` with mode 600.
- **Write tools require confirmation.** `create_workflow`, `edit_workflow`, `approve_todo`, `pause/resume` either require an interactive confirmation in the UI or a separately-scoped confirmation token. Read-only tools don't.
- **Audit log.** Every MCP call recorded with timestamp, client identity (where available), tool name, and arguments. Append-only, surfaced in the feed.

### AI integration

- **Assume prompt injection.** PR bodies, issue text, file contents reaching an agent's prompt may attempt to redirect its behaviour. The permission allowlist is the load-bearing defence — even a fully compromised agent can only do what its template allows. Prompt-level mitigations (system prompt framing) help but aren't relied on as primary defence.
- **Conservative allowlists.** Adding `Bash(*)` to any template requires a deliberate decision, never a quick fix to "make it work."

### Secrets

- **No secrets in workflow definitions.** Definitions are git-tracked. Secrets stay outside the repo, mode 600, referenced by name from the template.
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
- Dynamic per-call permission policy (static per template only)
- Persistent execution across app restarts (graceful halt on close, manual re-run on reopen)
- Custom DSL for workflows

## Phased build

Suggested ordering — cheapest viable spine first, layer up. Each phase a usable artifact.

1. **Spine.** Workflow runner that executes a YAML-defined linear pipeline of script nodes. Standard envelope. Traces captured. Run history persisted to SQLite via Drizzle.
2. **Feed UI.** Render run history as a feed. No live updates yet — reload-to-refresh. Expandable entry view.
3. **MCP read surface.** `list_workflows`, `run_workflow`, `get_run`, `list_runs`. Agent can now drive the system end-to-end.
4. **Cron triggers.** In-process tick loop, schedule field on workflows.
5. **Agent nodes.** CC CLI spawning, per-template settings dirs, prompt-injected allowlists, cost capture from transcripts.
6. **Todo list + gating.** Dedup keys, propose vs auto, right-rail UI.
7. **Live feed updates.** Streaming, filtering, summariser node.
8. **Global pause.** Top-right control, kill semantics.
9. **MCP write surface.** `create_workflow`, `approve_todo`, etc. — once the read surface feels solid.

## Open questions

- **Trace retention policy.** How long do verbose traces and CC transcripts stay in SQLite before pruning? Size-cap, time-cap, or both? Decision triggers the disk-blob split.
- **Templates vs inline scripts.** Defer until 3+ CC-flavoured workflows exist. Template extraction is a refactor, not a v1 decision.
- **Summariser model choice.** Haiku via API for speed/cost, or a CC session for consistency with the rest of the agent stack? Probably Haiku.
- **Secret store mechanism.** Mode-600 env files in a known dir, OS keychain integration, or 1Password CLI integration? Trade-off: friction vs ergonomics.
- **Seatbelt enforcement for arbitrary script nodes.** Wrapper script that invokes `sandbox-exec` with a per-template profile? Generated profile from declared filesystem/network needs? Worth prototyping early — this is the load-bearing defence for non-CC nodes.

## Prior art (reference, not imitation)

- **Windmill** — closest "shape" minus MCP/feed
- **Kestra** — declarative + git sync, more CI-flavoured
- **n8n** — recently added MCP, but graph-first UX
- **Rivet** — visual AI flows in Electron
- **Inngest / Trigger.dev** — event-driven dev primitives, cloud-oriented
- **Huginn** — old Ruby agents project that originated the "feed of events" model
-
