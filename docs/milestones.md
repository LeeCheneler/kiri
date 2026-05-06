# Kiri — Build Milestones

Companion to `orchestrator-design.md`. Sequenced for fastest path to dogfooding, then layering capability outward. Each milestone is independently usable.

## Design invariants (apply across all milestones)

These are constraints, not work items. They hold for every milestone below.

- Standard node envelope (`status`, `output`, `error`, `traces`, `usage`) — established in M0, never deferred
- Zod input/output schemas on every node — established in M0
- No shell interpolation of inputs anywhere — argv arrays and env vars only
- Kiri is a CLI launched per-repo; workflow definitions live in `<cwd>/workflows/` of whichever repo Kiri is running against. No global cross-repo store
- Repo-scoped runtime state lives in `<cwd>/.kiri/` (gitignored)
- Workflow definitions are loaded into an in-memory registry; there is no `workflows` table — TS files are the only source of truth
- Every run snapshots the resolved workflow definition and per-node materials (script source, prompt + settings later) at start; feed entries always reflect the exact code that ran
- Per-run scratch directory; scripts never run with cwd of repo or home
- Per-template env scope; no leaking of orchestrator state into scripts
- Output rendered as plain text in the UI for now (no markdown until a real need shows up)

## M0 — Spine (the dogfood threshold)

- Hono process serving HTTP and the SPA bundle
- Vite + React single-page UI, no router yet
- Repo-scoped startup: scaffold `workflows/` and `.kiri/` at cwd if missing, then open and migrate the state DB
- SQLite + Drizzle schema (in `.kiri/state.db`): `runs` (with definition snapshot), `run_nodes` (per-node envelope + materials snapshot). No `workflows` table
- Workflow definition loader: TS files in `<cwd>/workflows/` hydrate an in-memory registry; `defineWorkflow({...})` shape
- Script node executor: `child_process` spawn (argv + scoped env, never shell strings), stdout/stderr/exit captured, envelope assembled
- Per-run scratch directory under `.kiri/runs/<run-id>/`, created and cleaned up
- Run-start snapshot: capture the resolved workflow definition onto the `runs` row and each node's script source onto its `run_nodes` row before execution
- Manual trigger: list workflows in UI (from registry), "Run" button per workflow
- Feed view: reverse-chronological list of runs, click-to-expand for full envelope, traces, and per-node material snapshot
- Orphaned-workflow handling: runs whose workflow no longer exists in the registry render under their original name with a "(deleted)" badge
- Reload to refresh; no live updates
- Workflow definition hot-reload in dev (file watcher → registry rebuild)

**Done when:** a `kiri-self-review` workflow that calls `claude -p "$(git diff)"` runs end-to-end and its output is readable in the feed.

## M1 — Agent node as first-class kind

- New `agent` node kind in the workflow schema
- Per-template directory layout: `templates/<name>/{.claude/settings.json, prompt.tpl, run.sh}`
- Spawning: `CLAUDE_CONFIG_DIR`, `--allowedTools`, `--max-turns`, `--output-format json`
- Allowlist injection into prompt, framed positively ("you have access to…")
- Capture session ID from CC output
- Locate transcript at `~/.claude/projects/<hash>/<session>.jsonl`
- Parse transcript for tokens, model, derived cost (port the ccusage approach)
- Populate `usage` in envelope; cost rendered in feed entry header

**Note:** agent templates at this stage should stay read-only (`Read`, `Glob`, `Grep`) until M2 lands. Defer anything that edits files or runs side-effect commands until then.

## M2 — Security baseline

**Strategy.** This is a personal CLI tool: it runs while invoked, lives on `localhost`, and is gone when stopped. Two threats are real and worth defending against; the rest of the production-grade story (persistent auth, audit logs, HTTPS, secret stores, ulimits) is overkill for a single-user ephemeral process and explicitly out of scope.

The two threats:

- **CSRF from other browser tabs.** Any site you visit can issue cross-origin requests to `localhost`. State-changing side effects happen even if the response is blocked. Kiri spawns scripts — that makes it an RCE vector if undefended.
- **Workflow escape.** Templates with broad bash permissions (or just buggy scripts) can touch parts of the filesystem they shouldn't.

Work items:

- Bind HTTP listener to `127.0.0.1` only; assert at startup, refuse to bind elsewhere
- Require `X-Kiri-Client` header on every state-changing endpoint — custom headers force a CORS preflight that cross-origin attackers can't satisfy
- Per-template Seatbelt sandbox profile, applied by default to all script and agent execution
- Profile lives alongside the template (`templates/<name>/sandbox.sb` or similar); declared filesystem and network reach only

**Done when:** visiting a malicious page in another tab cannot trigger a workflow run; agent nodes with broad bash permissions can't reach outside their declared filesystem or network scope.

## M3 — Cron

- In-process tick loop, runs while Hono is up
- `schedule` field (cron expression) on workflow definitions
- Schedule registry rebuilt on workflow def reload
- Global concurrency cap: 1 in-flight run by default
- Scheduled runs flow through the same executor path as manual runs
- Missed runs while paused or app-down are dropped, not queued (matches app-active scope)

## M4 — Todos + gating

- `gating: "auto" | "propose"` field on workflow definitions
- Todo SQLite schema with lifecycle: pending → approved/auto → in-flight → completed/failed → archived
- Producing script declares the dedup key; existing pending todo with same key auto-archives
- Right-rail UI: pending todos with approve/reject inline
- Active todos linked to originating run and downstream feed entries
- Invoking a propose-gated workflow lands as a todo rather than executing immediately
- Auto-gated workflows run as before, with todo entry visible for traceability

## M5 — Polish

- SSE feed updates via Hono `streamSSE` — feed updates without reload
- Feed filtering and scoping (by workflow, by status)
- Summariser node: leaf-only (no recursion), generates condensed view for feed entries
- Decide and integrate summariser model (probably Haiku via API)
- Global pause control top-right; halts new invocations; modifier-click also kills in-flight

## M6 — MCP (deferred until trigger)

- Add when one of: (a) a recurring need to invoke workflows from inside CC sessions, or (b) wanting to use Kiri's todo list as an inbox CC can write into
- Tool surface: `list_workflows`, `run_workflow(name, inputs)`, `get_run(id)`, `list_runs(filter)`
- Note: "add a todo via MCP" is `run_workflow` against a propose-gated workflow — no separate primitive
- Localhost-only or Unix socket transport
- Reuses the M2 `X-Kiri-Client` header convention

## Out of scope (v1)

Capability:

- Branching, conditionals, fan-out/fan-in
- Auto-retry, DLQ
- File watches, webhooks, inbox polling (use polling-via-cron-workflow instead)
- Multi-user, auth, sharing
- Tool-granular gating (workflow-level only)
- Dynamic per-call permission policy (static per template only)
- Persistent execution across app restarts
- Custom DSL for workflows
- MCP write surface (`create_workflow`, `edit_workflow`, `approve_todo`, `pause/resume`)

Security (deliberately not built — single-user ephemeral local tool):

- Persistent auth tokens at well-known paths
- Audit logs
- HTTPS / custom subdomain (`localhost` over HTTP is fine)
- `ulimits` and resource caps on script execution
- Secret store mechanism (use env vars; revisit if it becomes painful)
- Output secret-pattern scrubbing
- UI sanitisation beyond plain-text rendering
