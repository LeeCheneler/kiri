# Kiri — Build Milestones

Companion to `design-notes.md`. M0–M6 are shipped — see `git log` for the history. Each milestone below is independently usable.

## Design invariants (apply across all milestones)

These are constraints, not work items. They hold for every milestone below.

- Standard step envelope (`status`, `output`, `error`, `traces`, `meta`) — established in M0, never deferred
- Workflow YAML validated against a Zod schema; the top-level shape is fixed (`steps`, `summarize`, `publish`, `triggers`, `gating`) but step `env:` contents are bundle-defined and not validated by kiri
- No shell interpolation of inputs anywhere — argv arrays and env vars only
- Kiri is a CLI launched per-repo; workflow definitions live in `<cwd>/workflows/` of whichever repo Kiri is running against. No global cross-repo store
- Repo-scoped runtime state lives in `<cwd>/.kiri/` (gitignored)
- Workflow definitions are loaded into an in-memory registry; there is no `workflows` table — YAML files are the only source of truth
- Every run snapshots the resolved workflow definition and the data-repo git ref (HEAD + dirty flag) at start; feed entries reflect the workflow shape that ran, and the sha pins the working tree for reproduction
- Per-run scratch directory; steps never run with cwd of repo or home
- Per-step env scope; user `env:` applied first, kiri- and OS-controlled vars overwrite on collision; `KIRI_` prefix reserved
- Step output rendered as plain text in the UI. Markdown rendering is reserved for surfaces with explicit content semantics — `publish:` articles (M6) and `summarize:` summaries — routed through the same sandboxed renderer. Raw step stdout/stderr stays plain text.

## M7 — Triggers

Workflows are manually triggered until this lands. M7 introduces a declarative `triggers:` block supporting two kinds — cron and file-watch — both feeding the same executor path as manual runs.

- `triggers:` array on workflow definitions; entries are `{ type: "cron", schedule }` or `{ type: "watch", paths, events?, debounceMs? }`. `paths` is a list of globs (chokidar semantics); `events` defaults to `["add", "change", "unlink"]`; `debounceMs` defaults to 500
- In-process tick loop drives cron; chokidar drives file watches; both run while Hono is up
- Trigger registry rebuilt on workflow def reload — cron schedules re-registered, file watcher subscriptions torn down and re-bound
- Per-workflow concurrency: at most one in-flight + one pending run; the pending slot is last-event-wins (a queued cron tick or file event is overwritten by a newer one, not stacked)
- Global concurrency cap stays at 1 in-flight run across all workflows
- Missed events while paused or app-down are dropped, not queued (matches app-active scope)
- Every step receives `KIRI_TRIGGER` (`"cron"` | `"watch"` | `"manual"`). Watch-triggered runs additionally receive `KIRI_TRIGGER_FILE` (absolute path of the file that fired the run) and `KIRI_TRIGGER_EVENT` (`"add"` | `"change"` | `"unlink"`). Reserved-namespace rules apply — workflow `env:` keys can't shadow them.

## M8 — Todos + gating

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
- Webhooks, inbox polling (use polling-via-cron-workflow instead)
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
- UI sanitisation beyond plain-text rendering for step output. Markdown rendering for `publish:` articles and `summarize:` summaries is the documented exception, gated to a hardened parser.
