# Kiri — Build Milestones

Companion to `design-notes.md`. Sequenced for fastest path to dogfooding, then layering capability outward. Each milestone is independently usable.

## Design invariants (apply across all milestones)

These are constraints, not work items. They hold for every milestone below.

- Standard step envelope (`status`, `output`, `error`, `traces`, `meta`) — established in M0, never deferred
- Workflow YAML validated against a Zod schema; the top-level shape is fixed (steps, schedule, gating) but step `env:` contents are bundle-defined and not validated by kiri
- No shell interpolation of inputs anywhere — argv arrays and env vars only
- Kiri is a CLI launched per-repo; workflow definitions live in `<cwd>/workflows/` of whichever repo Kiri is running against. No global cross-repo store
- Repo-scoped runtime state lives in `<cwd>/.kiri/` (gitignored)
- Workflow definitions are loaded into an in-memory registry; there is no `workflows` table — YAML files are the only source of truth
- Every run snapshots the resolved workflow definition and per-step materials at start; feed entries always reflect the exact code that ran
- Per-run scratch directory; steps never run with cwd of repo or home
- Per-step env scope; user `env:` applied first, kiri- and OS-controlled vars overwrite on collision; `KIRI_` prefix reserved
- Output rendered as plain text in the UI for now (no markdown until a real need shows up)

## M0 — Spine (the dogfood threshold)

- Hono process serving HTTP and the SPA bundle
- Vite + React single-page UI, no router yet
- Repo-scoped startup: scaffold `workflows/` and `.kiri/` at cwd if missing, then open and migrate the state DB
- SQLite + Drizzle schema (in `.kiri/state.db`): `runs` (with definition snapshot), `run_nodes` (per-step envelope + materials snapshot). No `workflows` table
- Workflow definition loader: YAML files in `<cwd>/workflows/` parsed and validated against a Zod schema, hydrated into an in-memory registry
- Script step executor: `child_process` spawn (argv + scoped env, never shell strings), stdout/stderr/exit captured, envelope assembled
- Per-run scratch directory under `.kiri/runs/<run-id>/`, created and cleaned up
- Run-start snapshot: capture the resolved workflow definition onto the `runs` row and each step's script source onto its row before execution
- Manual trigger: list workflows in UI (from registry), "Run" button per workflow
- Feed view: reverse-chronological list of runs, click-to-expand for full envelope, traces, and per-step material snapshot
- Interrupted-run handling: runs whose workflow no longer exists in the registry render under their original name with a "(deleted)" badge
- Reload to refresh; no live updates
- Workflow definition hot-reload in dev (file watcher → registry rebuild)

**Done when:** a `kiri-self-review` workflow that calls `claude -p "$(git diff)"` runs end-to-end and its output is readable in the feed.

## M1 — Step schema migration

Pure refactor: move workflow YAML from `nodes:`/`kind:` to the new `steps:`/`use:`/`sh:`/`env:` shape. No new functionality — existing workflows run identically under the new schema.

Work items:

- Schema rewrite: `steps:` array of one of `{ use: <name>, env?: { ... } }` or `{ sh: <string>, env?: { ... } }`. Mutually exclusive variants. `env:` keys must not start with `KIRI_` (load-time validation error).
- Bundle resolver: `use: <name>` resolves to `<cwd>/scripts/<name>/run.sh`. Missing bundle is a load-time validation failure for the referencing workflow (recorded in `result.failures`, doesn't crash startup).
- Step executor split: `use:` steps spawn `<bundle>/run.sh` with cwd set to the per-run scratch dir; `sh:` steps spawn via `sh -c "$inline"`. Both share the same env-scoping and precedence rules.
- Env precedence at spawn: user `env:` first, then kiri-injected vars (`KIRI_RUN_ID`, `KIRI_STEP_INDEX`, `KIRI_META_FILE`, `KIRI_REPO_ROOT`) and OS essentials (`PATH`, `HOME`, `USER`, `LOGNAME`) overwrite on key collision.
- Materials snapshot under the new shape: for `use:` steps capture the bundle directory contents (`run.sh` + any sidecar files); for `sh:` steps capture the inline shell text.
- DB rename: `run_nodes` table → `run_steps`. Other column names containing "node" updated for consistency. Drizzle migration generated; existing rows preserved through the rename.
- Code-symbol rename: `runNodes` → `runSteps`, `WorkflowNode` → `WorkflowStep`, `runScriptNode` → renamed to reflect the new dispatch (e.g. `runStep`), etc.
- JSON Schema regeneration covers the new shape.
- Re-home `scripts/kiri-self-review/review.sh` → `scripts/kiri-self-review/run.sh` (bundle layout). Update the workflow YAML accordingly.
- All existing tests updated; coverage holds at 100%.

**Done when:** `kiri-self-review` runs identically under the new schema; no user-visible change in behaviour.

## M2 — `claude-code` bundle starter

`kiri init` writes a working CC runner the user can drop into any workflow.

Work items:

- `kiri init` scaffolds `scripts/claude-code/{run.sh, README.md}` if missing. Existing files left untouched (matches the existing init behaviour for `workflows/example.yaml`).
- `run.sh` reads its env-var contract: `PROMPT_FILE` (path resolved against `KIRI_REPO_ROOT`), `MAX_TURNS`, `ALLOWED_TOOLS` (comma-separated), `MODEL` (optional).
- Synthesises a `.claude/settings.json` from `ALLOWED_TOOLS` into per-run scratch; sets `CLAUDE_CONFIG_DIR` to that dir.
- Loads the prompt from `PROMPT_FILE` and prepends the allowlist as positive framing ("You have access to: …. If you need anything else, end the session with a final message describing what you needed and why.").
- Spawns `claude -p "$PROMPT" --max-turns "$MAX_TURNS" --output-format json`, capturing the session ID.
- README documents the env-var contract, the model-default behaviour, and the (deferred) cost-capture wiring point.
- Dogfood: rewrite the `kiri-self-review` workflow to `use: claude-code` with a prompt file under `prompts/self-review.tpl`.
- **No cost / usage capture in this milestone** — that lands with the meta channel in M6.

**Note:** the bundle stays read-only at this milestone (`Read`, `Glob`, `Grep`) until M3 lands. Defer anything that edits files or runs side-effect commands until then.

**Done when:** `kiri-self-review` (now using the `claude-code` bundle) runs end-to-end and CC's final message appears in the feed.

## M2.5 — Hosted shell on local.kiri.build

Flips kiri's canonical URL from `http://localhost:4242` to `https://local.kiri.build`. A static HTML shell on Cloudflare Pages loads the locally-running kiri's bundle and calls the API there. Real HTTPS on a stable, bookmarkable URL with no on-host TLS termination.

Work items:

- Server: stable bundle paths so the shell can hard-code references — Vite emits `app.js` + `app.css` at the dist root rather than hashed filenames, and Hono serves them with `Cache-Control: no-store`. Hashed assets under `/assets/` stay immutable.
- Server: CORS allow-list permitting `https://local.kiri.build` (plus the `127.0.0.1`/`localhost` direct origins as fallback). Allow-list is mounted before route handlers so OPTIONS preflight is answered by middleware.
- `shell/index.html`: minimal hand-maintained HTML, loads `http://127.0.0.1:4242/app.{js,css}` with `crossorigin="anonymous"`. Single file, audit-by-sight.
- `shell/_headers`: `Cache-Control: public, max-age=300` on `/index.html` so a shell tweak propagates within minutes.
- `wrangler.toml`: `pages_build_output_dir = "./shell"`, project name fixed, so `wrangler pages deploy` resolves config without flag-shuffling — used by both CI and any local invocation.
- CI deploy: `cd.yml` job that runs `wrangler pages deploy` on pushes to `main` that touch `shell/` or `wrangler.toml`. Path-filtered so unrelated `main` pushes don't trigger redeploys; gated to `push` events only so PRs don't deploy.
- One-time Cloudflare setup (manual, documented in README): create the Pages project, attach `local.kiri.build` as a custom domain — Pages auto-provisions DNS + cert. `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` set as repo secrets.
- README: open-kiri instructions point at `https://local.kiri.build`, with `http://localhost:4242` retained as a fallback. Safari/Brave caveat documented (HTTPS→HTTP-localhost subresource blocking). One-time setup + deploy mechanism documented.

**Done when:** `https://local.kiri.build` resolves with a valid Pages cert and, with a local kiri running, shows the same UI as direct `http://127.0.0.1:4242` access.

**Out of scope:** local-served HTTPS for Safari/Brave (mkcert recipe), a friendly "kiri not running" UI state.

## M3 — Security baseline

**Strategy.** This is a personal CLI tool: it runs while invoked, lives on `localhost`, and is gone when stopped. The threat worth defending against is *external* — other tabs in the same browser issuing cross-origin requests to kiri's `localhost` API. The rest of the production-grade story (persistent auth, audit logs, HTTPS, secret stores, ulimits, kernel sandboxing of step execution) is overkill for a single-user ephemeral process and explicitly out of scope.

The threat:

- **CSRF from other browser tabs.** Any site you visit can issue cross-origin requests to `localhost`. State-changing side effects happen even if the response is blocked. Kiri spawns scripts — that makes it an RCE vector if undefended.

Bundle escape (a script reaching outside its declared filesystem or network scope) is *not* defended against at this layer. Bundles are scripts the user wrote into their own repo: the trust boundary is the same as any shell script they'd run on their machine. Treat `scripts/<name>/run.sh` like any other shell script — read it before you use it. Revisit if kiri ever grows a way to install bundles from elsewhere; until then, kernel sandboxing is cost without commensurate protection.

Work items:

- Bind HTTP listener to `127.0.0.1` only; assert at startup, refuse to bind elsewhere.
- Require `X-Kiri-Client` header on every state-changing endpoint — custom headers force a CORS preflight that cross-origin attackers can't satisfy.

**Done when:** visiting a malicious page in another tab cannot trigger a workflow run.

## M3.5 — UX foundation + test infrastructure

A web-app overhaul on top of test infrastructure that's been deferred up to now. The UI is restyled around a gov.uk-inspired design language — minimalist, high-contrast, typography-led, no shadows or gradients. Component tests via `bun:test` + `happy-dom` + `@testing-library/react`; E2E via Playwright. Tailwind v4 becomes the only styling mechanism in the client.

Realtime / SSE feed updates stay deferred to M7. The feed in this milestone reload-to-refreshes.

Work items:

- Component test infra: `bun:test` + `happy-dom` + `@testing-library/react`. Smoke `<App>` test to lock in wiring.
- E2E test infra: Playwright + a single golden-path test (boot kiri → list workflows → trigger a run → see it in the feed → open the run page).
- Tailwind v4 with design tokens following the gov.uk system: ink `#0b0c0c`, muted `#505a5f`, rule `#b1b4b6`, accent `#1d70b8`; status colours running `#1d70b8` / ok `#00703c` / failed `#d4351c` / interrupted `#f47738`; focus `#ffdd00`; body 18px / 1.5 line-height; headings 36 / 24 / 19 / 16 at weight 700; system sans + monospace stack. Replaces `src/client/app.css` entirely — no surviving hand-rolled CSS, no CSS modules, Tailwind utilities + `@layer components` only.
- Client router via `wouter`: `/` (dashboard) and `/runs/:id` (run page). Replaces the inline expanded-run view.
- Activity feed redesign: gov.uk-style entry rows with status strip, workflow name, status, trigger, started-at, duration. Borders or whitespace only, no cards.
- Workflow run page at `/runs/:id`: GitHub-Actions-shaped — header (workflow, status, trigger, duration, started-at) with per-step expandable sections covering stdout, stderr, duration, and the materials snapshot.
- Workflows list redesign: typography-led row with status, schedule slot (placeholder for M4), and trigger button.

**Done when:** the web app has been fully restyled in the gov.uk design language, the run-detail view is its own page, component + E2E tests run in CI, and Tailwind is the only styling mechanism in the client with no surviving hand-rolled CSS.

**Out of scope:**

- SSE / realtime feed updates (M7).
- Feed filtering and scoping (M7).
- Dark mode — defer until needed.
- Storybook or visual regression testing — `bun:test` + RTL + Playwright covers component and golden-path concerns. Revisit if visual regressions become a real problem.

## M3.9 — Live updates, toasts, and cancel

Replaces reload-to-refresh with live updates over SSE. Activity feed, run detail page, workflows side nav, and workflow detail page all react to a single in-process event bus the server pushes over `GET /api/events`. Run completions toast bottom-right when off the run page. Cancel button kills the in-flight child process from the run detail page.

Realtime / SSE feed updates were originally scoped to M7; pulled forward because the reload-to-refresh model is the dominant rough edge in the UX, and cancel + toasts are obvious adjacent capability once live updates exist.

Work items:

- In-process event bus emitting a small typed surface: `run.started`, `run.updated`, `run.step.updated`, `run.finished`, `workflow.added`, `workflow.updated`, `workflow.removed`.
- Executor publishes run/step events at lifecycle transitions; watcher publishes workflow events on registry changes.
- `GET /api/events` Hono `streamSSE` endpoint subscribes to the bus and forwards events. Existing CORS allowlist applies; the endpoint is read-only and exempt from the `X-Kiri-Client` header requirement (`EventSource` can't send custom headers; no CSRF write surface is exposed).
- Workflow watcher promoted from dev-only to always-on. The `NODE_ENV !== "production"` gate in `bin/kiri.ts` is removed — per-repo tooling has no meaningful "production" mode, and live YAML edits should reflect without restart.
- Client opens a single `EventSource('/api/events')` at boot; events trigger data-layer cache invalidation and views refetch via existing GETs. On (re)connect the client refetches all live views to recover from any missed events. No event log / `Last-Event-ID` resumption.
- Event payloads stay thin (IDs + status). The single relaxation is `run.finished`, which carries `workflowName` so the toast can render without a refetch round-trip.
- Toast notifications for completed runs:
  - Bottom-right stack; auto-dismiss after 6s; click navigates to the run detail page; X dismisses.
  - Suppressed if the user is already on `/runs/:id` for the finishing run.
  - Status-coloured strip matching the existing design tokens — no new visual language.
- Cancel:
  - `POST /api/runs/:id/cancel` (subject to `X-Kiri-Client`). 202 on cancel sent; 409 if already terminal.
  - Executor tracks the spawned child process per active run; cancel sends SIGTERM, waits ~2s, then SIGKILL.
  - New `cancelled` terminal status alongside `ok` / `failed`. Distinct status colour token. Drizzle migration extends the run + step status enums.
  - Concurrency slot released on cancel like any terminal transition.
  - Cancel button on run detail page, visible only when status is `running`. One-click, no confirmation modal.

**Done when:** triggering a run shows status transitions live in the feed without reload; the run detail page shows step transitions live; running a workflow off-page produces a bottom-right toast on completion; clicking cancel on an in-flight run halts the child and transitions the run to `cancelled` with all surfaces updating live.

**Out of scope:**

- Live stdout/stderr streaming during step execution. Logs still land all-at-once on step completion; line-by-line streaming is a separate follow-on.
- Event log / `Last-Event-ID` resumption. Best-effort delivery; clients refetch on (re)connect.
- Toast notifications for workflow file changes or run starts. Side nav + feed updating live is the right level of feedback for those.
- Feed filtering and scoping (M7).
- Summariser step (M7).
- Global pause control (M7).

## M3.95 — Activity feed summaries

Each completed run gets a one-or-two-sentence AI summary surfaced in the activity feed and at the top of the run detail page. Workflows opt in via a new `summarize:` field; kiri ships a `claude-code-summarizer` bundle (haiku, prompt baked in, zero env vars) so the default `kiri init` experience produces summaries out of the box.

The summariser was originally scoped to M7; pulled forward because the feed is the system's primary UX surface ("feed-first UI" is one of the two stated differentiators) and runs render as bare workflow-name + status rows without it. Once cron lands the feed fills up faster, so summaries are worth landing before that pressure arrives.

Work items:

- Workflow schema: optional `summarize:` field, same `{ use, env? } | { sh, env? }` shape as a step. Same load-time validation rules (mutually exclusive variants, `KIRI_` prefix banned, missing `use:` bundle is a workflow load failure).
- Executor extension: after the `steps:` loop terminates (`ok` or `failed`, but not `cancelled`), if `summarize:` is set, run it via the same `runStep` path as a regular step. Recorded in `run_steps` with `is_summary: true`; on success, stdout (trimmed) lands on `runs.summary`. Summariser failure does not affect `runs.status` — the feed falls back to today's rendering, and the run detail page exposes the failed summariser execution for debugging.
- New injected env var: `KIRI_RUN_CONTEXT_FILE`, path under per-run scratch. Kiri writes the full run envelope (workflow name, status, duration, per-step kind/status/duration/stdout/stderr/error) as JSON before spawning the summariser; the bundle decides how to format it for the prompt.
- DB: `runs.summary TEXT NULL`, `run_steps.is_summary INTEGER NOT NULL DEFAULT 0`. Drizzle migration; existing rows unaffected.
- `claude-code-summarizer` bundle: spawns `claude -p --max-turns 1` with haiku and a baked-in prompt, fed the JSON envelope. README documents the no-config posture and how to fork. `kiri init` scaffolds it alongside `claude-code/`.
- Example workflow wiring: `EXAMPLE_WORKFLOW_YAML` (and kiri's own dogfood `workflows/example.yaml`) gain `summarize: { use: claude-code-summarizer }` so the default new-repo experience produces summaries.
- Activity feed renders the summary under the workflow name when present, line-clamped. Run detail page renders a "Summary" section under the header and a separate "Summariser execution" disclosure below the steps for debugging. `is_summary` rows are filtered from the main step list.
- `run.finished` fires after the summariser completes — toast latency picks up haiku's invocation time (~1–3s). No separate `summary.updated` event.

**Done when:** running a workflow with `summarize: { use: claude-code-summarizer }` produces a summary visible in the activity feed and at the top of the run detail page; workflows without `summarize:` render identically to today.

**Out of scope:**

- Configurable summariser prompt or model on the shipped bundle — fork the bundle to customise.
- Summarising cancelled runs (cancel = "stop now"; spawning haiku defeats user intent).
- Streaming the summary as it generates.
- Multi-step summarisers (single step only, like a regular entry).
- A separate `summary.updated` event — `run.finished` carries the terminal state and the summary lands before it fires.

## M3.97 — Onboarding & docs

Polish around the canonical URL. Three pieces: a friendly fallback when the hosted shell loads but no local kiri is running, a one-sheet docs site at `local.kiri.build/docs`, and a link to it from the running app's side panel.

M2.5 set up `local.kiri.build` as the canonical entry point but explicitly punted on the "kiri not running" UI state — visitors who bookmark the URL and hit it cold currently see a blank page. Slotted ahead of M4 (cron) so the cold-load and discovery experience holds up before the surface area grows.

Work items:

- Hosted shell fallback: `shell/index.html` keeps its single-file, audit-by-sight shape. Add an inline pre-rendered instructions panel, hidden by default, fading in if the kiri bundle fails to load. Two detection paths combined — script `onerror` (immediate on connection-refused in Chromium/Firefox) and a 1.5s timeout backstop checking whether `#root` has children (covers Safari/Brave mixed-content blocking and any browser where `onerror` doesn't fire reliably). Panel content: heading, the `kiri` command in a code block, a link to the docs site for install instructions, and the existing Safari/Brave caveat pointing at `http://localhost:4242`.
- One-sheet docs site at `shell/docs/index.html`, served at `https://local.kiri.build/docs` by Cloudflare Pages. Hand-written single file, same gov.uk-style design tokens as the running app for visual consistency. Sections: what kiri is, install (homebrew placeholder marked "coming soon" with a fallback to Releases / CONTRIBUTING.md), quick start, a minimal `steps:` workflow, `use:` bundle example, inline `sh:` example, `summarize:` example, trust-model summary, and links to GitHub / design-notes / milestones.
- Side-panel docs link in `src/client/components/page-shell.tsx`, below the workflows nav in the left rail. Subtle treatment matching the existing smallcaps heading style, `target="_blank" rel="noopener"`, hardcoded to `https://local.kiri.build/docs` so it works whether the user opened the hosted shell or `http://localhost:4242` directly.

**Done when:** visiting `https://local.kiri.build` with no local kiri running fades in clear instructions to start it; `/docs` is a published one-sheet covering install through `summarize:`; the running app links to the docs from the left rail.

**Out of scope:**

- Public homebrew tap — placeholder install command only; tap setup is gated on the repo going public.
- Cron section in the docs — lands with M4.
- Localised / translated docs.
- Search or multi-page navigation in the docs site.
- Per-tag deep links into the docs.

## M4 — Cron

- In-process tick loop, runs while Hono is up
- `schedule` field (cron expression) on workflow definitions
- Schedule registry rebuilt on workflow def reload
- Global concurrency cap: 1 in-flight run by default
- Scheduled runs flow through the same executor path as manual runs
- Missed runs while paused or app-down are dropped, not queued (matches app-active scope)

## M5 — Todos + gating

- `gating: "auto" | "propose"` field on workflow definitions
- Todo SQLite schema with lifecycle: pending → approved/auto → in-flight → completed/failed → archived
- Producing step declares the dedup key (mechanism TBD when this milestone starts — likely a conventional meta key once M6 lands; if M5 ships first, parsed from stdout)
- Right-rail UI: pending todos with approve/reject inline
- Active todos linked to originating run and downstream feed entries
- Invoking a propose-gated workflow lands as a todo rather than executing immediately
- Auto-gated workflows run as before, with todo entry visible for traceability

## M6 — Generic step meta

Generic key-value channel any step can populate. Kiri stays runtime-blind; the `claude-code` bundle populates conventional keys because its `run.sh` happens to.

Work items:

- `KIRI_META_FILE` env var injected on every step (path under per-run scratch).
- After the step finishes, kiri reads the file if present, validates JSON, folds into `meta` on the envelope.
- DB: per-step row gains a `meta` JSON column.
- `claude-code` bundle updated: at end of run, parse the CC transcript (port the ccusage approach), write `{ cost_usd, tokens_in, tokens_out, model }` to `$KIRI_META_FILE` before exit.
- Feed UI: meta rendered as key-value pairs in the expanded entry view.
- Header promotion: conventional keys (`cost_usd`, `tokens_in`, `tokens_out`) shown inline in the feed entry header.

**Done when:** the `kiri-self-review` workflow's CC step shows cost in the feed entry header; an arbitrary `sh:` step that writes `{"foo": "bar"}` to `$KIRI_META_FILE` renders that key/value in the expanded view.

## M7 — Polish

- SSE feed updates via Hono `streamSSE` — feed updates without reload
- Feed filtering and scoping (by workflow, by status)
- Global pause control top-right; halts new invocations; modifier-click also kills in-flight

## M8 — MCP (deferred until trigger)

- Add when one of: (a) a recurring need to invoke workflows from inside CC sessions, or (b) wanting to use Kiri's todo list as an inbox CC can write into
- Tool surface: `list_workflows`, `run_workflow(name, inputs)`, `get_run(id)`, `list_runs(filter)`
- Note: "add a todo via MCP" is `run_workflow` against a propose-gated workflow — no separate primitive
- Localhost-only or Unix socket transport
- Reuses the M3 `X-Kiri-Client` header convention

## Out of scope (v1)

Capability:

- Branching, conditionals, fan-out/fan-in
- Auto-retry, DLQ
- File watches, webhooks, inbox polling (use polling-via-cron-workflow instead)
- Multi-user, auth, sharing
- Tool-granular gating (workflow-level only)
- Dynamic per-call permission policy (static per step only)
- Persistent execution across app restarts
- Custom DSL for workflows
- MCP write surface (`create_workflow`, `edit_workflow`, `approve_todo`, `pause/resume`)

Security (deliberately not built — single-user ephemeral local tool):

- Persistent auth tokens at well-known paths
- Audit logs
- HTTPS / custom subdomain (`localhost` over HTTP is fine)
- `ulimits` and resource caps on script execution
- Kernel sandboxing of step execution (e.g. macOS Seatbelt). Revisit if a bundle-install mechanism ever lands; until then bundles are user-authored and trusted as such.
- Secret store mechanism (use env vars; revisit if it becomes painful)
- Output secret-pattern scrubbing
- UI sanitisation beyond plain-text rendering
