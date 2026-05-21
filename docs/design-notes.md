# Kiri — Design Notes

> *Kiri* (キリト) — Short for Kirito, the protagonist of *Sword Art Online*. Always wanted to call my dog Kiri.

## Concept

A local-first, git-based workflow orchestrator for personal automation. Scripts and AI workflows triggered by cron or manual invocation. A feed UI streams activity, a todo list captures gated proposals, and a global pause provides a panic button. Single user (me), running while the app is active.

What sets kiri apart from Windmill, Kestra, n8n, Inngest et al. is the **feed-first UI** — activity stream as the primary surface, not a node-graph canvas.

## Core principles

- **App-active scope.** Everything runs while the app is open. No daemons, no launchd, no overnight execution. Sleep/wake is not our problem.
- **Single user.** No auth, no multi-tenancy, no scaling.
- **Git as source of truth.** Workflow definitions, prompts, and scripts live in a git repo.
- **Linear pipelines only.** No branches, no conditionals, no fan-out/fan-in. `script → ai → script` covers most real cases.
- **Everything is a workflow.** A workflow is N≥1 steps. Single-step workflows wrap "just run a script" cases. Cron triggers workflows. Todos invoke workflows. Manual menu items are workflows. One concept, uniform treatment everywhere.

## Architecture

### Workflow definition

YAML files validated against a Zod schema. No custom DSL.

```yaml
name: pr-review
triggers:                  # optional, M7 — cron + file watch
  - type: cron
    schedule: "*/15 * * * *"
  - type: watch
    paths: ["~/notes/**/*.md"]
gating: auto               # or "propose" (M8)
steps:
  - use: fetch-pr           # script bundle: scripts/fetch-pr/run.sh
    env:
      PR_NUMBER: "42"
  - use: claude-code        # script bundle: scripts/claude-code/run.sh (example, see examples/)
    env:
      PROMPT_FILE: prompts/pr-review.tpl
      MAX_TURNS: "50"
  - sh: |                   # inline shell — sugar for trivial steps
      echo "review complete"
      date
publish:                   # optional, M6: long-form markdown articles
  - name: digest
    title: "PR Review Digest"
    use: claude-code
    env:
      PROMPT_FILE: prompts/pr-digest.tpl
summarize:                 # optional one or two sentence feed summary
  use: claude-code-summarizer
```

A step is one of two shapes:

- `{ use: <name>, env?: { ... } }` — references a **script bundle** at `scripts/<name>/run.sh`. The bundle is a folder containing at minimum `run.sh` plus any sidecar files it needs (prompt files, generated settings, README documenting the bundle's env-var contract).
- `{ sh: <string>, env?: { ... } }` — inline shell script, run via `sh -c`. Sugar for one-shots that don't deserve their own bundle. Multi-line via YAML's `|` block scalar.

`env:` is a flat string-to-string map, passed verbatim to the bundle (or inline shell). Each bundle defines its own contract for what keys it expects; kiri doesn't validate config contents. Kiri's own scoped vars (`KIRI_RUN_ID`, `KIRI_STEP_INDEX`, `KIRI_REPO_ROOT`, `KIRI_TRIGGER`, plus `KIRI_TRIGGER_FILE` and `KIRI_TRIGGER_EVENT` on watch-triggered runs) and OS essentials (`PATH`, `HOME`, `USER`, `LOGNAME`) are applied **after** user env at spawn time, so a workflow can't override them. The `KIRI_` prefix is reserved — workflow `env:` keys starting with `KIRI_` are rejected at load time.

Two workflow-level sibling fields run alongside `steps:`:

- **`summarize:`** — a single `{ use | sh, env? }` entry executed after `steps:` and `publish:` complete, only when the run is still `ok`. Its stdout becomes the run's one-or-two-sentence summary, rendered on the activity feed row and at the top of the run detail page. The `claude-code-summarizer` example bundle ships with a baked-in prompt and `MODEL=haiku` so it produces summaries out of the box once copied into a workspace. M4 makes prompt and model configurable via `env:` without forking the bundle.
- **`publish:`** — an array of named long-form markdown articles (M6). Each entry has the shape `{ name, title?, use | sh, env? }`. Each runs in declared order, serially, via the same `runStep` path as a regular step, after `steps:` and before `summarize:` so the summariser can reference articles in its context. Publishes only run when the steps pipeline is `ok` — a failed or cancelled pipeline skips them. Sibling publishes keep running after one fails, but a failing publish flips the run to `failed` and skips the summariser. Articles are stored as rows in `articles`, surfaced as chips on the activity feed, listed under a "Published" section on the run detail page, and rendered on dedicated `/runs/:id/published/:name` pages via a sandboxed markdown parser.

Both fields share the same load-time validation as `steps:` (`use:` / `sh:` mutually exclusive, `KIRI_` prefix banned on `env:` keys, missing `use:` bundle is a workflow load failure). A failing summariser is non-fatal — its error stays on the step row but the run terminal status is unaffected. A failing publish flips `runs.status` to `failed`.

This single primitive — the script bundle — supports every runtime kiri will ever care about. The repo's `examples/` carries `claude-code` and `lm-studio` starter bundles; LM Studio support is `cp -r examples/scripts/claude-code scripts/lm-studio` and editing the script. Kiri itself stays runtime-blind: it spawns `run.sh`, captures the envelope, and stays out of the way.

Rationale for YAML over TS: workflow files live in arbitrary user repos, but kiri ships as a single Bun-compiled binary. Resolving a TS `import { defineWorkflow } from "kiri"` from those repos would require both a Bun plugin baked into the binary to intercept the import *and* generated `.d.ts` files dropped into each repo for IDE support — both maintenance costs that compound forever. YAML is pure data, validated at load time, and a JSON schema can be published alongside the binary for editor LSP integration with no per-repo footprint.

### Standard step envelope

Every step returns the same shape. Designed in early — painful to retrofit.

```ts
{
  status: "ok" | "failed",
  output: unknown,         // becomes the next step's input
  error?: { message, stack? },
  traces: { stdout, stderr, durations, ... },
}
```

Full I/O captured at every step. Linked from the corresponding feed entry for debugging and replay.

### Execution semantics

- **Concurrency:** global default of 1 in-flight workflow run. Per-workflow override added later only if needed.
- **Errors:** step fails → workflow halts → run marked failed → feed entry shows error → manual re-run from the feed entry.
- **No auto-retry, no DLQ, no fan-out** in v1.

### Triggers

Three kinds, declared on the workflow as a `triggers:` array (cron, watch) or invoked imperatively (manual):

- **Cron** — `{ type: cron, schedule: <expr> }`. In-process tick loop while the app is active.
- **Watch** — `{ type: watch, paths: [<glob>], events?, debounceMs? }`. chokidar-backed; `events` defaults to `[add, change, unlink]`; `debounceMs` defaults to 500 to coalesce editor save bursts. Runs receive `KIRI_TRIGGER_FILE` (absolute path) and `KIRI_TRIGGER_EVENT` so the step can read what changed.
- **Manual** — invoked from the UI (menu, feed, todo). No declaration needed.

Every step receives `KIRI_TRIGGER` (`cron` | `watch` | `manual`) so bundles can branch on origin.

**Coalescing.** Each workflow has at most one in-flight + one pending run. The pending slot is last-event-wins — a queued cron tick or file event is overwritten by a newer one, not stacked. A burst of 50 file changes during a long-running run lands as one follow-up run carrying the most recent event. The global cap of 1 in-flight run across all workflows is unchanged; per-workflow pending slots wait on the global slot.

**Missed events.** While paused or app-down, events are dropped, not replayed. Matches the "while the app is active" invariant.

No webhooks or inbox polling — polling-via-cron-workflow handles those shapes.

### State storage

State lives in three tiers, by what kind of state it is:

- **In git** — workflow definitions (`.yaml` files), script bundles (`scripts/<name>/`), prompt files, sandbox profiles. Everything that benefits from review and version history.
- **In SQLite** — runtime state: runs, todos, schedules, app state (paused/running, in-flight counter), run metadata + envelopes. Single file in the data dir, queryable, indexed, transactional. **bun:sqlite** as the driver (synchronous, fast, statically linked into the Bun runtime), **Drizzle** for schema and migrations.
- **On disk (data dir)** — large blob payloads referenced by path from SQLite rows: full CC transcripts, big stdout dumps, anything that'd bloat the DB. Same pattern CI systems use to keep the DB lean.

Pragmatic v1 simplification: skip the disk-blob split initially. Put traces straight into SQLite TEXT columns. Move to disk-backed blobs only when a "last 50 runs" feed query starts dragging on trace payloads — probably won't for months.

### Workflow registry & run snapshots

Workflow definitions are YAML files in `workflows/` — the single source of truth, with no SQL representation. There is **no `workflows` table**. On startup (and on file change in dev) the loader scans the directory, parses each file, validates it against the workflow Zod schema, and hydrates an in-memory registry; runs reference workflows by name only.

When a run starts, the executor captures two things to pin the run's context:

- The resolved workflow definition (name, steps, env, gating, schedule, summarize, publish) onto the `runs` row as `definitionSnapshot`. Feed entries always show the workflow shape that ran, even if the YAML file is later edited or deleted (UI shows a "(deleted)" badge when the registry no longer has the name).
- The data repo's git ref at run-start: the HEAD commit (`runs.gitSha`) plus a `runs.gitDirty` flag for uncommitted changes. The data dir is already a git repo by convention, so a single SHA pins every file the run could possibly have read — bundle scripts, prompts, anything `run.sh` resolves at runtime. The UI renders the short sha (with a dirty marker when applicable) in the run header.

Kiri does not snapshot individual bundle files or prompts into the database. Reproducing what ran means `git checkout <sha>` in the data repo. Both `gitSha` and `gitDirty` are nullable so a non-git data dir is a first-class state, not an error — the run loses the reproducibility affordance but everything else works.

Re-running an old run uses the *current* definition and *current* working tree, not the snapshot. Replay-from-snapshot is out of scope for v1.

## Todo system

Workflows can produce todos. A todo is a proposed workflow invocation waiting for approval (or auto-execution if its workflow is configured `gating: "auto"`).

- **Deduplication.** The producing script declares the dedup key. Recommended shape for repo-scoped tasks: `{repo}/{pr_id}/{head_sha}` — new commits produce a new todo and the old one auto-archives, preserving timeline integrity.
- **Gating.** Per-workflow toggle: `auto` (run immediately, post results to feed) or `propose` (sit in todo list, wait for human approval).
- **Lifecycle.** Pending → approved (or auto) → in-flight → completed/failed → archived. Visible in the right-rail todo view with linked feed entries.

## AI integration

### Claude Code via the `claude-code` bundle

Kiri integrates with Claude Code through a `claude-code` script bundle — a worked example carried in the repo's `examples/` that the user copies into their workspace's `scripts/` and owns from then on. Kiri itself has no CC-specific code; the bundle does the spawning, config translation, transcript parsing, and meta emission. Spawning CC's CLI directly keeps Max subscription billing in play — the Agent SDK is API-billed only and not on the table for this personal tool.

Bundle layout (`examples/scripts/claude-code/`):

```
claude-code/
  run.sh         # spawns `claude` CLI with the resolved prompt + allowlist
  README.md      # documents the env-var contract: PROMPT_FILE, MAX_TURNS, ALLOWED_TOOLS, MODEL
```

Workflow usage:

```yaml
- use: claude-code
  env:
    PROMPT_FILE: prompts/pr-review.tpl
    MAX_TURNS: "50"
    ALLOWED_TOOLS: "Read,Glob,Grep,Bash(gh pr view:*)"
    MODEL: opus              # optional
```

What `run.sh` does at spawn time:

- Reads its env-var contract (`PROMPT_FILE`, `MAX_TURNS`, `ALLOWED_TOOLS`, `MODEL`).
- Synthesises a `.claude/settings.json` in per-run scratch from `ALLOWED_TOOLS`, sets `CLAUDE_CONFIG_DIR` to that dir.
- Loads the prompt from `PROMPT_FILE` (resolved against `KIRI_REPO_ROOT`) and **prepends the allowlist as positive framing** ("You have access to: …. If you need anything else, end the session with a final message describing what you needed and why.") so the agent doesn't burn turns on denied tools.
- Spawns `claude -p "$PROMPT" --max-turns "$MAX_TURNS"` and forwards its stdout/stderr to kiri's standard step envelope.

The bundle is plain bash — readable, modifiable, replaceable. Adding LM Studio support is `cp -r examples/scripts/claude-code scripts/lm-studio` and editing. The example lives in the repo; the user owns their copy from there.

### Output validation (for LLM steps producing structured output)

Three tiers, in order:

1. Use structured output / tool use at the API level. Kills ~95% of "wrapped in backticks" failures.
2. Validate against Zod schema. On failure, one-shot retry with the validation error fed back into the prompt.
3. *Optional* dedicated cleanup model — constrained to format-level repairs only. Stripping backticks: safe. Reshaping prose into fields: not safe.

### Cost tracking

Deferred. The earlier design carried a generic `meta` channel (`KIRI_META_FILE`) for steps to emit `{ cost_usd, tokens_in, tokens_out, model }`, with the UI promoting conventional keys to feed headers. The channel was never read back and the cost numbers never landed, so the wiring was retired to keep the runtime contract honest. Picking this up later means re-introducing both the file channel (or a different transport) and the UI promotion; ccusage's transcript-parsing approach remains the reference for the underlying numbers.

### Permissions philosophy

Static policy per step via `ALLOWED_TOOLS` in the workflow's `env:`. The `claude-code` bundle's `run.sh` synthesises a `.claude/settings.json` at spawn time and points CC at it — so the workflow YAML is the load-bearing source of permission truth, no hand-edited settings files anywhere in the user's repo. **No runtime hooks for v1.** Hooks are reserved for if/when dynamic per-call policy is wanted (token budget caps, mid-session escalation, tool-granular propose-to-approve).

For workflows using broad `Bash(*)` permissions, the load-bearing defence is the static `ALLOWED_TOOLS` allowlist on the step itself, plus the user's own claude config. Kiri does not wrap steps in a kernel sandbox: bundles are user-authored scripts in the user's own repo, with the same trust posture as any shell script they'd run themselves. If a bundle-install mechanism is ever added (a marketplace, `kiri install <bundle>`, etc.), revisit — the trust boundary changes at that point.

## UI

Two regions today (right rail and top-right pause land with todos and polish):

- **Left rail: workflows nav.** Lists workflows from the registry, each linking to its detail page.
- **Center: feed.** Reverse-chronological activity log. Each row shows workflow name, status, trigger, duration, and (when present) the run's one-or-two-sentence summary plus a chip-list of published articles. Clicking a row opens the run detail page (`/runs/:id`) with full traces; clicking an article chip opens its dedicated page (`/runs/:id/published/:name`).
- **Right rail: todos.** Pending proposals + active items. Approve/reject inline. (Lands with M8.)
- **Top right: global pause.** Halts new invocations. Modifier to also kill in-flight runs. (Lands with M10.)

Cost visibility is deferred (see *Cost tracking* above).

## Application stack

The orchestrator is a single Node process serving both the engine and the UI. The user "uses the app" by visiting a local URL in their browser; the process keeps running regardless of whether that browser tab is open.

### Stack

- **Bun** — runtime. TypeScript runs natively (no separate compile step), `bun:sqlite` is statically linked (no native-module headache), and `bun build --compile` produces a single-file macOS binary — the release artifact for distribution. One toolchain for install, test, run, and build.
- **Hono** — HTTP server, SSE streams. Runtime-agnostic by design but pairs cleanly with Bun via `Bun.serve`. The Hono process *is* the orchestrator daemon: runs the cron tick loop, executes workflows, serves the UI bundle. One process, clear ownership.
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
    claude-code/              # an example bundle copied in; user owns it
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

- Workflow inputs (from polled external content, upstream step output, or anywhere user-controlled bytes can land) are untrusted data.
- Polled external content (PR titles, issue bodies, file contents from third-party repos) is untrusted.
- AI agents may attempt actions outside their intended scope due to prompt injection, misalignment, or simple error.
- The local machine is otherwise trusted (this is a personal tool on the user's own laptop).

### Trust boundaries

- **Workflow definitions, prompts, and scripts** (files in git) are *trusted*. They are reviewed and version-controlled.
- **Workflow inputs** at runtime are *untrusted*. They come from external polling or upstream step outputs that may have processed third-party data.
- **AI outputs** are *untrusted*. Even from a tightly-scoped agent, output is data, not commands. When it flows downstream as input to another step, it must be treated as untrusted input.

### Script execution

- **No shell interpolation of inputs.** Workflow inputs are passed via env vars or argv arrays, never spliced into shell command strings. The orchestrator constructs argument lists, the OS handles them, no shell parsing of user-controlled strings.
- **Per-step working directory.** Each workflow run gets a scratch directory; the step's cwd is set there, not the user's home or the orchestrator repo.
- **Per-step env scope.** Steps only see env vars from the step's `env:` block plus a small kiri-controlled set (`KIRI_RUN_ID`, `KIRI_STEP_INDEX`, `KIRI_REPO_ROOT`, `KIRI_TRIGGER`, plus `KIRI_TRIGGER_FILE` / `KIRI_TRIGGER_EVENT` on watch-triggered runs) and the OS essentials (`PATH`, `HOME`, `USER`, `LOGNAME`). No other parent-process env leaks through.
- **Env precedence at spawn.** User-declared `env:` is applied first; kiri- and OS-controlled vars overwrite on key collision. A workflow can't redirect `PATH` to inject a malicious binary or shadow `KIRI_RUN_ID` to confuse run identity.
- **Reserved namespace.** `env:` keys starting with `KIRI_` are rejected at workflow load time as a schema error. Typos and accidental collisions surface as load failures, not silent overwrites at spawn.
- **Resource limits.** ulimits on CPU time, memory, file descriptors, and disk writes. A runaway script halts cleanly rather than degrading the system.
- **No kernel sandbox.** Bundles run with the user's permissions. The trust posture is "scripts you authored or pasted into your own repo, same as any shell script you'd run yourself" — sandbox-wrapping every step is cost without protection in that model. The defence here is `ALLOWED_TOOLS` on the step plus reading the bundle before you use it.

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
- Webhooks, inbox polling
- Multi-user, auth, sharing
- Tool-granular propose-to-approve (workflow-level only)
- Dynamic per-call permission policy (static per step only)
- Persistent execution across app restarts (graceful halt on close, manual re-run on reopen)
- Custom DSL for workflows

## Phased build

Sequenced for fastest path to dogfooding, then layering capability outward. Each phase a usable artifact. Detailed work items per milestone live in `milestones.md`.

**Shipped (M0 – M6):**

1. **Spine** (M0). YAML-defined linear pipeline of script steps. Standard envelope, traces captured, run history persisted to SQLite via Drizzle. Feed UI renders run history.
2. **Step schema migration** (M1). YAML moved to `steps:` with `use:` (bundle reference) or `sh:` (inline shell), plus per-step `env:` with precedence and reserved-namespace rules.
3. **`claude-code` bundle starter** (M2). A working CC runner bundle that translates `env:` keys to CC flags, spawns `claude`, and captures the session.
4. **Hosted shell** (M2.5). `https://local.kiri.build` — a static Cloudflare Pages shell that loads the locally-running kiri's bundle. Stable bundle paths, CORS allow-list.
5. **Security baseline** (M3). Bind to `127.0.0.1` only; require `X-Kiri-Client` header on state-changing endpoints — shuts down cross-origin attacks from other browser tabs.
6. **UX foundation + test infra** (M3.5). Tailwind v4; `wouter` router with `/` and `/runs/:id`; `bun:test` + `happy-dom` + `@testing-library/react`; Playwright golden-path e2e.
7. **Live updates, toasts, cancel** (M3.9). In-process event bus, SSE endpoint, EventSource cache invalidation, completion toasts, in-flight cancel.
8. **Activity feed summaries** (M3.95). Workflow-level `summarize:` field, `claude-code-summarizer` bundle, summary rendered in feed and at the top of run detail.
9. **Onboarding & docs** (M3.97). Hosted-shell fallback when no local kiri is running, one-sheet docs site at `/docs`, in-app link.
10. **Configurable summariser** (M4). `PROMPT` / `PROMPT_FILE` / `MODEL` / `MAX_TURNS` env support on `claude-code-summarizer` with defaults preserved; `PROMPT` added to `claude-code` with precedence over `PROMPT_FILE`.
11. **Cursor-based feed pagination** (M5). Infinite-scroll feed; live updates and cold-load cost decoupled from total run count.
12. **Article publishing** (M6). `publish: [...]` array on workflows. Markdown articles stored in `articles`, surfaced as chips on the feed and a "Published" section on run pages, opened on dedicated `/runs/:id/published/:name` pages via a sandboxed renderer.

**Next up (M7 onwards):**

13. **Triggers** (M7). `triggers:` block on workflows: `cron` (in-process tick loop) and `watch` (chokidar globs). Per-workflow depth-1 pending slot plus global cap of 1 in-flight. Watch-triggered runs get `KIRI_TRIGGER_FILE` / `KIRI_TRIGGER_EVENT`; every run gets `KIRI_TRIGGER`.
14. **Todos + gating** (M8). `gating:` field, dedup keys, propose vs auto, right-rail UI.
15. **Generic step meta** (M9). Deferred. The original design used a `KIRI_META_FILE` file channel for steps to emit cost/tokens/model; that wiring was retired without ever being read back. Re-introducing this needs both a transport and the UI promotion to feed-entry headers.
16. **Polish** (M10). Feed filtering and scoping, global pause control with kill-in-flight modifier.

## Open questions

- **Trace retention policy.** How long do verbose traces and CC transcripts stay in SQLite before pruning? Size-cap, time-cap, or both? Decision triggers the disk-blob split.
- **Secret store mechanism.** Mode-600 env files in a known dir, OS keychain integration, or 1Password CLI integration? Trade-off: friction vs ergonomics.

## Prior art (reference, not imitation)

- **Windmill** — closest "shape" minus the feed-first UX
- **Kestra** — declarative + git sync, more CI-flavoured
- **n8n** — graph-first UX
- **Rivet** — visual AI flows in Electron
- **Inngest / Trigger.dev** — event-driven dev primitives, cloud-oriented
- **Huginn** — old Ruby agents project that originated the "feed of events" model
-
