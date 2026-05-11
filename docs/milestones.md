# Kiri — Build Milestones

Companion to `design-notes.md`. M0–M3.97 are shipped — see `git log` for the history. Each milestone below is independently usable.

## Design invariants (apply across all milestones)

These are constraints, not work items. They hold for every milestone below.

- Standard step envelope (`status`, `output`, `error`, `traces`, `meta`) — established in M0, never deferred
- Workflow YAML validated against a Zod schema; the top-level shape is fixed (`steps`, `summarize`, `publish`, `schedule`, `gating`) but step `env:` contents are bundle-defined and not validated by kiri
- No shell interpolation of inputs anywhere — argv arrays and env vars only
- Kiri is a CLI launched per-repo; workflow definitions live in `<cwd>/workflows/` of whichever repo Kiri is running against. No global cross-repo store
- Repo-scoped runtime state lives in `<cwd>/.kiri/` (gitignored)
- Workflow definitions are loaded into an in-memory registry; there is no `workflows` table — YAML files are the only source of truth
- Every run snapshots the resolved workflow definition and the data-repo git ref (HEAD + dirty flag) at start; feed entries reflect the workflow shape that ran, and the sha pins the working tree for reproduction
- Per-run scratch directory; steps never run with cwd of repo or home
- Per-step env scope; user `env:` applied first, kiri- and OS-controlled vars overwrite on collision; `KIRI_` prefix reserved
- Step output rendered as plain text in the UI. Markdown rendering is reserved for surfaces with explicit content semantics — `publish:` artefacts (M6) and `summarize:` summaries — routed through the same sandboxed renderer. Raw step stdout/stderr stays plain text.

## M4 — Configurable summariser

Bring the summariser bundle to feature-parity with `claude-code` so users can customise prompt, model, and turn budget directly from the workflow YAML without forking the bundle. Defaults preserve today's zero-config posture.

Work items:

- `claude-code-summarizer` bundle: read `PROMPT`, `PROMPT_FILE`, `MODEL`, `MAX_TURNS` env vars. All optional. Defaults: baked-in summariser prompt, `MODEL=haiku`, `MAX_TURNS=1`.
- `claude-code` bundle: add `PROMPT` env var support alongside the existing `PROMPT_FILE`. (Existing `MAX_TURNS` and `MODEL` already supported; no other additions.)
- Precedence rule in both bundles: when both `PROMPT` and `PROMPT_FILE` are set, `PROMPT` wins and `PROMPT_FILE` is ignored. Documented in both READMEs.
- Existing `{{VAR}}` placeholder rendering applies to whichever source produces the prompt text.
- Summariser still receives the run envelope via `KIRI_RUN_CONTEXT_FILE`; the user-supplied `PROMPT` replaces the framing only, not the context delivery mechanism.
- READMEs updated to document the full env-var contract per bundle and the precedence rule.
- Integration tests cover: `PROMPT` only, `PROMPT_FILE` only, `PROMPT` overriding `PROMPT_FILE`, `MODEL` override, all-defaults summariser invocation.

**Done when:** a workflow can configure the summariser prompt, model, and turn budget entirely from YAML (`summarize: { use: claude-code-summarizer, env: { PROMPT: "...", MODEL: "sonnet" } }`) without modifying the bundle, and workflows that don't set any of those env vars behave identically to today.

**Out of scope:** changing the shipped default model (still haiku); summariser-specific env keys beyond what `claude-code` itself accepts; `ALLOWED_TOOLS` plumbing (intentionally not in `claude-code` either — permissions are deferred to the user's `~/.claude/settings.json`).

## M5 — Cursor-based feed pagination

The activity feed currently loads every run on mount. That holds up while runs are manually triggered, but once cron (M7) and artefact publishing (M6) land the feed will fill faster and the cold load becomes a real cost. Switch to cursor-based pagination with infinite scroll; keep the live-update story intact.

Work items:

- API: `GET /api/runs?cursor=<id>&limit=<n>` returning `{ runs, nextCursor }`. Cursor is the last seen `runs.id`. Default limit 25, max 100.
- Client: replace the existing single-fetch hook with a paginated fetch keyed on cursor.
- Intersection observer on a sentinel near the bottom of the feed triggers loading the next page.
- Live-event compatibility: `run.started` prepends a new row at the top; `run.updated` / `run.finished` patch the matching visible row; new pages append below without disturbing rows already on-screen.
- On (re)connect, refetch the first page only — recovers without reloading the entire feed history.
- Empty state, end-of-feed indicator, loading sentinel — styled consistently with the existing feed.

**Done when:** the feed fetches one page on mount; scrolling near the bottom loads subsequent pages; live events continue to flow correctly; cold load latency is independent of total run count.

**Out of scope:** filtering and scoping (M10 polish); search; date-jump; full-text search of run output.

## M6 — Artefact publishing

Workflows can produce one or more long-form markdown artefacts per run. Each artefact is named, stored in the DB, surfaced as a chip on the activity feed and as a "Published" section on the run page, and clickable through to a dedicated artefact page that renders the full markdown.

Driving use case: a HackerNews digest workflow publishes a full markdown article each run; the summariser highlights the top story and one-lines the rest in the feed; the user clicks the chip to read the long-form digest.

Work items:

- Schema: optional `publish:` array on the workflow definition. Each entry has the shape `{ name, title?, use, env? } | { name, title?, sh, env? }`.
  - `name` matches `^[a-z0-9-]+$`, required, unique within the workflow.
  - `title` optional; defaults to titlecased `name`.
  - Mutually exclusive `use:` / `sh:` variants; `KIRI_` prefix banned on `env:` keys (load-time error). Missing `use:` bundle is a workflow load failure (recorded in `result.failures`, same as steps today).
- DB: new `run_artefacts` table (`id`, `run_id`, `name`, `title`, `content_md`, `created_at`), unique index on `(run_id, name)`. New `run_steps.is_publish INTEGER NOT NULL DEFAULT 0` flag (parallel to the existing `is_summary` flag). Drizzle migration.
- Executor: after `steps:` complete with `ok` or `failed` (not `cancelled`), iterate `publish:` serially via the existing `runStep` path, **before** `summarize:`. Each publish gets `KIRI_RUN_CONTEXT_FILE` with the envelope so far. Stdout is trimmed and written to `run_artefacts`. Publish failures do not affect `runs.status`; they appear in `run_steps` for debugging and are filtered from the main step list in the UI (same treatment as `is_summary` rows).
- Summariser context: the envelope JSON written to `KIRI_RUN_CONTEXT_FILE` for the summariser includes the successful artefacts so the summary can reference them.
- Router: `/runs/:id/published/:name` artefact page. Full-width markdown rendered through a sandboxed parser (`marked` + `DOMPurify`, no raw-HTML pass-through). Header shows workflow / run id / created-at with a back link to the run page.
- Run detail page: "Published" section above the steps, one row per artefact (title + link to the dedicated page).
- Activity feed: per-row chip list of artefact titles when present; chips link to the artefact page. Collapse to a single "N artefacts" chip at 4+ to keep the row compact.
- Examples: rewrite `hackernews-digest` to publish a full markdown article and have the summariser highlight the top story.

**Done when:** running a workflow with `publish: [...]` produces accessible markdown artefacts; chips appear on the relevant feed rows; the run page lists them under a "Published" section; clicking a chip opens the dedicated artefact page rendered as full markdown.

**Out of scope:**

- External destinations (gist, file write back to the repo, git commit, webhook POST)
- Non-markdown content types
- Parallel publish execution within a run
- Publishing on cancelled runs
- Cross-run aggregation page (`/published`) listing every artefact across workflows — useful later, not now

## M7 — Cron

(Originally M4; pushed back behind publish + pagination. Workflows are manually triggered until this lands.)

- In-process tick loop, runs while Hono is up
- `schedule:` field (cron expression) on workflow definitions
- Schedule registry rebuilt on workflow def reload
- Global concurrency cap: 1 in-flight run by default
- Scheduled runs flow through the same executor path as manual runs
- Missed runs while paused or app-down are dropped, not queued (matches app-active scope)

## M8 — Todos + gating

(Originally M5; pushed back behind the items above.)

- `gating: "auto" | "propose"` field on workflow definitions
- Todo SQLite schema with lifecycle: pending → approved/auto → in-flight → completed/failed → archived
- Producing step declares the dedup key (mechanism TBD when this milestone starts — parsed from stdout, since M9's meta channel is deferred)
- Right-rail UI: pending todos with approve/reject inline
- Active todos linked to originating run and downstream feed entries
- Invoking a propose-gated workflow lands as a todo rather than executing immediately
- Auto-gated workflows run as before, with todo entry visible for traceability

## M9 — Generic step meta (deferred)

Originally a generic key-value channel any step can populate, with `claude-code` writing `{ cost_usd, tokens_in, tokens_out, model }` for cost visibility on the feed.

**Status: deferred.** An earlier iteration shipped the runner side (`KIRI_META_FILE` env injection + a `usage` column on `run_steps`) without the read-back or UI promotion. The unread file channel and unused column were retired alongside the snapshot rework so the runtime contract reflects what actually runs. Picking this back up means deciding the transport (file channel, stdout sentinel, or something else) and then implementing the full read-back + DB persistence + feed-header promotion as a single landed feature — no half-shipped scaffolding.

Reference for the underlying numbers when this is revisited: ccusage's transcript-parsing approach.

## M10 — Polish

- Feed filtering and scoping (by workflow, by status)
- Global pause control top-right; halts new invocations; modifier-click also kills in-flight

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
- Agent-driven control surface (kiri is not an agent harness)
- Publishing to external destinations (gist, git commit, webhook POST). `publish:` is in-app only for v1.

Security (deliberately not built — single-user ephemeral local tool):

- Persistent auth tokens at well-known paths
- Audit logs
- HTTPS / custom subdomain (`localhost` over HTTP is fine; `https://local.kiri.build` is a hosted shell, not on-host TLS)
- `ulimits` and resource caps on script execution
- Kernel sandboxing of step execution (e.g. macOS Seatbelt). Revisit if a bundle-install mechanism ever lands; until then bundles are user-authored and trusted as such.
- Secret store mechanism (use env vars; revisit if it becomes painful)
- Output secret-pattern scrubbing
- UI sanitisation beyond plain-text rendering for step output. Markdown rendering for `publish:` artefacts and `summarize:` summaries is the documented exception, gated to a hardened parser.
