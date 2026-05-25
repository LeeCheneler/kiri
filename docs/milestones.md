# Kiri — Build Milestones

Companion to `design-notes.md`. M0–M7 are shipped — see `git log` for the history. Each milestone below is independently usable.

## Design invariants (apply across all milestones)

These are constraints, not work items. They hold for every milestone below.

- Standard step envelope (`status`, `output`, `error`, `traces`) — established in M0, never deferred
- Workflow YAML validated against a Zod schema; the top-level shape is fixed (`steps`, `inputs`, `summarize`, `publish`) but step `env:` contents are bundle-defined and not validated by kiri
- No shell interpolation of inputs anywhere — argv arrays and env vars only
- Kiri is a CLI launched per-repo; workflow definitions live in `<cwd>/workflows/` of whichever repo Kiri is running against. No global cross-repo store
- Repo-scoped runtime state lives in `<cwd>/.kiri/` (gitignored)
- Workflow definitions are loaded into an in-memory registry; there is no `workflows` table — YAML files are the only source of truth
- Every run snapshots the resolved workflow definition and the data-repo git ref (HEAD + dirty flag) at start; feed entries reflect the workflow shape that ran, and the sha pins the working tree for reproduction
- Per-run scratch directory; steps never run with cwd of repo or home
- Per-step env scope; user `env:` applied first, kiri- and OS-controlled vars overwrite on collision; `KIRI_` prefix reserved
- Step output rendered as plain text in the UI. Markdown rendering is reserved for surfaces with explicit content semantics — `publish:` articles (M6) and `summarize:` summaries — routed through the same sandboxed renderer. Raw step stdout/stderr stays plain text.

## M8 — Recommendations

Workflows surface proposed follow-up workflow invocations attached to the producing run. Each recommendation is a trigger button on the run detail page that opens the standard invoke modal pre-filled with the recommendation's workflow + inputs. Not a global queue; not a lifecycle state machine — emit-time output that mirrors `publish:` articles.

- `KIRI_RECOMMENDATIONS_FILE` env var injected on every main step's spawn — not on `publish:` or `summarize:`. Per-step file path in the run's scratch dir.
- File contents are JSON Lines, one recommendation per line: `{ title, workflow, description?, inputs? }`. `inputs` is a `Record<string, string>` matching the target workflow's declared inputs; the invoke modal pre-fills with these values.
- After each `ok` step's envelope is written, the runner ingests its recommendations file: one row per parsed line into a `recommendations` table linked to the run, preserving emission `index`. Malformed lines are logged and skipped without failing the step. Failed and cancelled steps skip their file entirely.
- `recommendations` table: `id`, `runId`, `index`, `title`, `description`, `workflow`, `inputs` (JSON), `actionedRunId` (nullable FK to `runs`), `actionedAt` (nullable). Indexes on `(runId)` and `(actionedRunId)`.
- Run detail page renders a "Recommended" section, sibling to "Published," beneath the steps section.
- Triggering a recommendation opens the standard invoke modal pre-filled with `workflow` + `inputs` — the user can edit before confirming. On confirm, the runner spawns the workflow, and the recommendation row is updated with `actionedRunId` + `actionedAt`. The trigger button flips into a status-badged link to the spawned run.
- Run delete cascade: the deleted run's own recommendations are removed; recommendations from other runs whose `actionedRunId` points at the deleted run have it nulled (`actionedAt` nulled with it), restoring them to triggerable.
- Rerun semantics: the rerun's own recommendations are wiped (mirrors articles + steps); recommendations from other runs pointing at the rerun via `actionedRunId` are left untouched — the link still resolves to a real run, even if the run's content has changed.
- Feed entry surfaces a small count when a run has recommendations ("3 recommendations").
- A recommendation whose `workflow` is no longer in the registry renders the trigger button disabled with a "workflow not found" tooltip.

## Out of scope (v1)

Capability:

- Branching, conditionals, fan-out/fan-in
- Auto-retry, DLQ
- Webhooks, inbox polling (poll inside a manually-invoked workflow step instead)
- Multi-user, auth, sharing
- Global todo / inbox surface for cross-workflow proposed actions (recommendations attach to the producing run only)
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
