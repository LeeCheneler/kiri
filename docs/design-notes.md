# Kiri — Design Notes

> *Kiri* (キリト) — Short for Kirito, the protagonist of *Sword Art Online*. Always wanted to call my dog Kiri.

## Concept

A local-first, git-based tool for personal automation. Scripts, AI workflows, and agentic chat invoked by hand. A feed UI streams activity, and each run can surface recommended follow-up runs as one-click trigger buttons on its detail page. Single user (me), running while the app is active.

Kiri has **two pillars**, both feeding the same activity feed:

- **Workflows** — the original pillar. YAML-defined linear pipelines (`script → ai → script`) invoked by hand. Deterministic, fixed-shape; an `llm:` step is one prompt in, text out. The pillar everything below under *Architecture* and *AI integration* describes.
- **Agentic sessions** — a multi-turn agentic chat against a configured model: system prompt, tools, streaming, images. A conversation, not a pipeline. Described under *Agentic sessions*.

The two are **separate concepts with separate config, storage, execution, and UI** — they share infrastructure (config dir, SQLite, the event bus, the LLM provider registry) and the activity feed, but a workflow is never an agent and an agent is never a workflow. They stay decoupled by design; the only planned bridge is an eventual *run-a-workflow tool* an agent could call — a tool the agent invokes, not a merging of the two models.

What sets kiri apart from Windmill, Kestra, n8n, Inngest et al. is the **feed-first UI** — activity stream as the primary surface, not a node-graph canvas.

## Core principles

- **App-active scope.** Everything runs while the app is open. No daemons, no launchd, no overnight execution. Sleep/wake is not our problem.
- **Single user.** No auth, no multi-tenancy, no scaling.
- **Git as source of truth.** Workflow definitions, prompts, and scripts live in a git repo.
- **Linear pipelines only (workflows).** Workflows have no branches, no conditionals, no fan-out/fan-in. `script → ai → script` covers most real cases. (Agentic sessions are iterative by nature; this constraint is a property of the workflow pillar, not of kiri.)
- **Everything in the workflow pillar is a workflow.** A workflow is N≥1 steps. Single-step workflows wrap "just run a script" cases. Todos invoke workflows. Manual menu items are workflows. One concept, uniform treatment — within the workflow pillar.
- **Two pillars, no crossover.** Workflows and agentic sessions are independent. They share infrastructure and the activity feed, never each other's execution, config, or storage. Don't reach for a workflow primitive to build a session feature, or vice versa.

## Design invariants

Constraints, not work items — they hold across the whole system:

- Standard step envelope (`status`, `output`, `error`, `traces`), never deferred per step.
- Workflow YAML validated against a Zod schema; the top-level shape is fixed (`steps`, `inputs`, `summarize`, `publish`, `description`, `group`) but step `env:` contents are bundle-defined and not validated by kiri.
- No shell interpolation of inputs anywhere — argv arrays and env vars only.
- Kiri is a CLI launched per-workspace; workflow definitions live in `<workspace>/workflows/`. No global cross-repo store.
- Repo-scoped runtime state lives in `<workspace>/.kiri/` (gitignored).
- Workflow definitions load into an in-memory registry; there is no `workflows` table — YAML files are the only source of truth.
- Every run snapshots the resolved workflow definition and the data-repo git ref (HEAD + dirty flag) at start; feed entries reflect the workflow shape that ran, and the sha pins the working tree for reproduction.
- Per-run scratch directory; steps never run with cwd of repo or home.
- Per-step env scope; user `env:` applied first, kiri- and OS-controlled vars overwrite on collision; `KIRI_` prefix reserved.
- Step output renders as plain text in the UI; markdown rendering is reserved for `publish:` articles and `summarize:` summaries, routed through the same sandboxed renderer.

## Architecture

### Workflow definition

YAML files validated against a Zod schema. No custom DSL.

```yaml
name: pr-review
description: Review a pull request and summarise findings.  # optional, shown on the workflow page
group: Dev                 # optional, buckets related workflows in the catalog + page eyebrow
inputs:                    # optional — parameters collected via a modal at invocation
  - name: pr_number
    description: The PR to review
    required: true
steps:
  - use: fetch-pr           # script bundle: bundles/fetch-pr/run.sh
    name: Fetch the PR      # optional short label, shown as the step title in the UI
    env:
      PR_NUMBER:
        input: pr_number    # resolved at spawn from the run's inputs snapshot
  - use: claude-code        # script bundle: bundles/claude-code/run.sh (example, see examples/)
    env:
      PROMPT_FILE: prompts/pr-review.tpl
      MAX_TURNS: "50"
  - llm:                    # first-party LLM completion — model from kiri.yaml
      model: anthropic:claude-haiku-4-5
      prompt_file: prompts/pr-summary.tpl
  - sh: |                   # inline shell — sugar for trivial steps
      echo "review complete"
      date
publish:                   # optional: long-form markdown articles
  - slug: digest
    name: "PR Review Digest"
    use: claude-code
    env:
      PROMPT_FILE: prompts/pr-digest.tpl
summarize:                 # optional one or two sentence feed summary
  use: claude-code-summarizer
```

A step is exactly one of three shapes:

- `{ use: <name>, name?, description?, env?: { ... } }` — references a **script bundle** at `bundles/<name>/run.sh`. The bundle is a folder containing at minimum `run.sh` plus any sidecar files it needs (prompt files, generated settings, README documenting the bundle's env-var contract).
- `{ sh: <string>, name?, description?, env?: { ... } }` — inline shell script, run via `sh -c`. Sugar for one-shots that don't deserve their own bundle. Multi-line via YAML's `|` block scalar.
- `{ llm: { model, prompt? | prompt_file? }, name?, description?, env?: { ... } }` — **first-party LLM completion** against a model declared in `kiri.yaml` (see *AI integration → LLM providers*). `model` is a `provider:model` id; the prefix must name a registered provider or the workflow fails to load. The prompt is inline (`prompt`) or a workspace-root-relative file (`prompt_file`) — declaring both is a schema error, and a declared `prompt_file` must exist on disk at load. `steps:` and `publish:` require one of the two; `summarize:` may omit both, falling back to a baked-in summary prompt.

The optional `name` is a short label rendered as the step's title in the Schema tab and the run timeline; it falls back to the bundle reference, the llm model id, or the script's first non-empty line. `description` is longer detail shown when a step's row is expanded.

`env:` is a flat string-to-string map, passed verbatim to the bundle (or inline shell). Each bundle defines its own contract for what keys it expects; kiri doesn't validate config contents. Kiri's own scoped vars (`KIRI_RUN_ID`, `KIRI_STEP_INDEX`, `KIRI_REPO_ROOT`) and OS essentials (`PATH`, `HOME`, `USER`, `LOGNAME`) are applied **after** user env at spawn time, so a workflow can't override them. The `KIRI_` prefix is reserved — workflow `env:` keys starting with `KIRI_` are rejected at load time.

Two workflow-level sibling fields run alongside `steps:`:

- **`summarize:`** — a single `{ use | sh | llm, env? }` entry executed after `steps:` and `publish:` complete, only when the run is still `ok`. Its stdout becomes the run's one-or-two-sentence summary, rendered on the activity feed row and at the top of the run detail page. The `claude-code-summarizer` example bundle ships with a baked-in prompt and `MODEL=haiku` so it produces summaries out of the box once copied into a workspace. Prompt and model are configurable via `env:` without forking the bundle.
- **`publish:`** — an array of named long-form markdown articles. Each entry has the shape `{ slug, name?, use | sh | llm, env? }`. Each runs in declared order, serially, via the same `runStep` path as a regular step, after `steps:` and before `summarize:` so the summariser can reference articles in its context. Publishes only run when the steps pipeline is `ok` — a failed or cancelled pipeline skips them. Sibling publishes keep running after one fails, but a failing publish flips the run to `failed` and skips the summariser. Articles are stored as rows in `articles`, surfaced as a stacked list on each activity-feed row, in a "Published" section of the run detail page's right rail, and rendered on dedicated `/runs/:id/published/:slug` pages via a sandboxed markdown parser. The article page lifts the body's first markdown `# heading` out as the page title — dropping any preamble before it — shows the publish name as the eyebrow series label (suppressed when it just restates the workflow name), and treats the body's `##` headings as the sections that fill the page's table of contents; a body with no `# heading` falls back to the publish name for its page title. Each surface that lists articles shows the article body's first markdown `# heading` as a sub-byline (when present) so identically-titled articles from the same workflow are distinguishable. Article markdown may embed fenced `chart` blocks — Vega-Lite JSON specs rendered inline as SVG charts through that same parser, with the charting library code-split so it loads only for articles that use one — and fenced `mermaid` blocks, rendered as diagrams (with a tab to read the source and an enlarge-to-modal action) through mermaid in its `strict`, DOMPurify-sanitising mode, likewise code-split so the diagram library loads only for articles that use one.

Both fields share the same load-time validation as `steps:` (a step is exactly one of `use:` / `sh:` / `llm:`, `KIRI_` prefix banned on `env:` keys; a missing `use:` bundle, an unknown llm provider prefix, or a missing `prompt_file` is a workflow load failure). A failing summariser is non-fatal — its error stays on the step row but the run terminal status is unaffected. A failing publish flips `runs.status` to `failed`.

The script bundle is the primitive for everything kiri reaches by spawning a process; first-party `llm:` steps cover the plain-completion case without forcing a bundle. The repo's `examples/` carries `claude-code` and `lm-studio` starter bundles; LM Studio support is `cp -r examples/bundles/claude-code bundles/lm-studio` and editing the script. For a **script step** kiri stays runtime-blind: it spawns `run.sh`, captures the envelope, and stays out of the way. An `llm:` step is the deliberate exception — kiri makes the completion call in-process against the configured provider — but its result maps onto the same envelope, so everything downstream (traces, `publish:`, `summarize:`) is identical to a script step's.

Rationale for YAML over TS: workflow files live in arbitrary user repos, but kiri ships as a single Bun-compiled binary. Resolving a TS `import { defineWorkflow } from "kiri"` from those repos would require both a Bun plugin baked into the binary to intercept the import *and* generated `.d.ts` files dropped into each repo for IDE support — both maintenance costs that compound forever. YAML is pure data, validated at load time, and a JSON schema can be published alongside the binary for editor LSP integration with no per-repo footprint.

### Standard step envelope

Every step returns the same shape. Designed in early — painful to retrofit.

```ts
{
  status: "ok" | "failed",
  output: unknown,         // becomes the next step's input
  error?: { message, stack? },
  traces: { stdout, stderr, durations, usage?, ... },
}
```

Full I/O captured at every step. Linked from the corresponding feed entry for debugging and replay. `traces.usage` carries token counts and is present only on `llm:` steps (see *AI integration → LLM step execution*).

### Execution semantics

- **Concurrency:** global default of 1 in-flight workflow run. Per-workflow override added later only if needed.
- **Errors:** step fails → workflow halts → run marked failed → feed entry shows error → manual re-run from the feed entry.
- **No auto-retry, no DLQ, no fan-out** in v1.

### Invocation & inputs

Runs are invoked manually — from the workflow catalog, by re-running an existing run, or by triggering a recommendation. There is no time-based or file-based triggering: under the app-active scope a scheduler would only ever fire while the user is already at the keyboard, where clicking Run is the same gesture for no extra capability. Polling shapes (webhooks, inboxes) are served by a workflow whose first step does the poll, invoked when the user wants it.

A workflow optionally declares `inputs:` — named parameters collected at invocation time, so one definition can be aimed at many targets (one `pr-review` workflow with a `pr_number` input reviews any PR, instead of one YAML file per PR).

- `inputs:` is an array of `{ name, description?, required?, default?, options? }`. Values are strings.
- A workflow with no `inputs:` runs immediately on invoke. One with `inputs:` collects values via a form before the run starts — `required` inputs must be filled, `default` pre-fills the field.
- An input can declare a fixed list of allowed strings via `options:`. The invoke modal then renders a picker constrained to those values instead of a text field, the declared `default` (if any) must be one of the entries — enforced at load time — and any value supplied at invoke must also be one of them.
- Step `env:` values are either a literal string or a structured `{ input: <name> }` reference pointing at a declared input. At run-start the runner resolves each declared input to a final value (supplied at invoke, otherwise the input's `default`) and snapshots the resolved `Record<string, string>` onto `runs.inputs`. At spawn the runner walks each step's, summarise's, and publish's `env:`, replacing every `{ input: <name> }` entry with the snapshotted value; kiri-scoped vars and OS essentials overlay afterwards, so user env never wins on collision.
- Input values are snapshotted onto the `runs` row, so the feed shows what a run was invoked with and a re-run can pre-fill the form.

### State storage

State lives in three tiers, by what kind of state it is:

- **In git** — workflow definitions (`.yaml` files), script bundles (`bundles/<name>/`), prompt files, sandbox profiles. Everything that benefits from review and version history.
- **In SQLite** — runtime state: runs, todos, app state (paused/running, in-flight counter), run metadata + envelopes. Single file in the data dir, queryable, indexed, transactional. **bun:sqlite** as the driver (synchronous, fast, statically linked into the Bun runtime), **Drizzle** for schema and migrations.
- **On disk (data dir)** — large blob payloads referenced by path from SQLite rows: full CC transcripts, big stdout dumps, anything that'd bloat the DB. Same pattern CI systems use to keep the DB lean.

Pragmatic v1 simplification: skip the disk-blob split initially. Put traces straight into SQLite TEXT columns. Move to disk-backed blobs only when a "last 50 runs" feed query starts dragging on trace payloads — probably won't for months.

### Workflow registry & run snapshots

Workflow definitions are YAML files in `workflows/` — the single source of truth, with no SQL representation. There is **no `workflows` table**. On startup (and on file change in dev) the loader scans the directory, parses each file, validates it against the workflow Zod schema, and hydrates an in-memory registry; runs reference workflows by name only.

When a run starts, the executor captures three things to pin the run's context:

- The resolved workflow definition (name, steps, env, summarize, publish) onto the `runs` row as `definitionSnapshot`. Feed entries always show the workflow shape that ran, even if the YAML file is later edited or deleted (UI shows a "(deleted)" badge when the registry no longer has the name).
- The resolved input values onto `runs.inputs`. Null when the workflow declared no `inputs:` block; otherwise a `Record<string, string>` with one entry per declared input that resolved to a value (supplied at invoke or via the input's `default`). The same snapshot is consulted when resolving `{ input: <name> }` env references at every step's, summarise's, and publish's spawn.
- The data repo's git ref at run-start: the HEAD commit (`runs.gitSha`) plus a `runs.gitDirty` flag for uncommitted changes. The data dir is already a git repo by convention, so a single SHA pins every file the run could possibly have read — bundle scripts, prompts, anything `run.sh` resolves at runtime. The sha and dirty flag are captured for reproduction (`git checkout <sha>`); they are not surfaced in the run detail UI.

Kiri does not snapshot individual bundle files or prompts into the database. Reproducing what ran means `git checkout <sha>` in the data repo. Both `gitSha` and `gitDirty` are nullable so a non-git data dir is a first-class state, not an error — the run loses the reproducibility affordance but everything else works.

Re-running an old run uses the *current* definition and *current* working tree, not the snapshot. Replay-from-snapshot is out of scope for v1.

## Recommendations

Workflows can surface proposed follow-up workflow invocations alongside the run that produced them. A run that aggregates open PRs, for example, can emit one recommendation per PR pointing at a `pr-review` workflow with `pr_number` pre-filled — turning the aggregator's output into a launch pad for one-click follow-ups.

Recommendations are not a global queue. There is no inbox, no right-rail list, no lifecycle state machine. Each recommendation belongs to its producing run, surfaces on that run's detail page, and is acted on or ignored in place. The shape mirrors `publish:` articles: emit-time output, persisted as rows linked to the run.

### Emission

A step writes JSON Lines to a file path provided in `KIRI_RECOMMENDATIONS_FILE` (per step, in the run's scratch dir):

```jsonl
{"title":"Review PR #123","description":"+500/-200, refactor user auth","workflow":"pr-review","inputs":{"pr_number":"123"}}
{"title":"Review PR #124","description":"+12/-3, fix typo","workflow":"pr-review","inputs":{"pr_number":"124"}}
```

Per-line fields: `title` (required), `workflow` (required — name of the workflow to invoke), `description` (optional — displayed under the title), `inputs` (optional `Record<string, string>` pre-filled into the invoke modal). Only the main `steps:` get the env var — `publish:` and `summarize:` do not emit recommendations. A failed step's file is discarded; only `ok` steps contribute rows. Malformed lines are logged and skipped without failing the step retrospectively.

### Storage

Stored in a `recommendations` table linked to the producing run via `runId`, with `index` preserving emission order. Each row carries the emitted payload plus two nullable mutables: `actionedRunId` and `actionedAt`, set when the user triggers the recommendation. No state machine; the only transition is "untriggered → triggered (with a run id pinned)." Indexes on `(runId)` for the detail-page read and `(actionedRunId)` to keep the cascade cheap on run delete.

### Actioning

On the run detail page, recommendations render as a "Recommended" section beneath the run's phases (Published having moved to the right rail). Each entry shows title + description and a trigger button. Clicking the button opens the standard invoke modal pre-filled with the recommendation's `workflow` + `inputs`; the user can edit before confirming, same gesture as a normal invoke. On confirm, the runner spawns the workflow and the recommendation row's `actionedRunId` + `actionedAt` are written. The trigger button flips into a status-badged link to the spawned run.

If the actioned run is later deleted, `actionedRunId` and `actionedAt` are nulled in the same delete transaction, restoring the recommendation to triggerable. Rerun reuses the run id, so a rerun of an actioned run leaves the recommendation's link intact — same behaviour as everywhere else: the destination mutates but the link still works.

A recommendation whose `workflow` is no longer in the registry renders the trigger button disabled with a "workflow not found" tooltip — same affordance as the "deleted" badge on feed rows for missing workflows.

The feed entry surfaces a small count when a run has recommendations ("3 recommendations" in the row's byline), signalling to click through to the detail page.

## AI integration

### LLM providers (in `kiri.yaml`)

First-party LLM steps reference named endpoints declared under `providers:` in the workspace-root `kiri.yaml` — kiri's structured config file (providers today; tools and settings will join them as siblings). It's a `providers:` map keyed by a name of your choosing:

```yaml
providers:
  anthropic:
    type: anthropic                  # required — anthropic | openai | openai-compatible
  work-openai:
    type: openai
    api_key: { env: WORK_OPENAI_KEY }
  local:
    type: openai-compatible
    base_url: http://localhost:1234/v1
```

- **File name.** The canonical name is `kiri.yaml`; `kiri.yml` is accepted too. If both exist, `kiri.yaml` wins and kiri logs a warning so the duplicate can be removed.
- **Scaffolded on first launch.** Kiri writes a commented `kiri.yaml` (every entry commented out) when a workspace has neither `kiri.yaml` nor `kiri.yml`, so a fresh workspace gets a self-documenting skeleton with no `kiri init` step. It never overwrites an existing file, and an empty or comment-only file loads as "no config".
- **`type` is always required** and selects the API the endpoint speaks; there is no inference from the entry's key. Each entry is a discriminated union on `type`, so the published JSON Schema enforces every rule in-editor — notably that `openai-compatible` requires a `base_url`.
- **`api_key` is an `{ env: <NAME> }` reference only**, never a literal key. This mirrors the `{ input: }` idiom in workflow `env:` and keeps secrets out of the git-tracked YAML. When omitted, `anthropic`/`openai` fall back to the conventional `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`; `openai-compatible` needs no key.
- Kiri reads the config at startup into an in-memory registry. A **missing file is first-class** — an empty registry, not an error. A present file is validated, and a declared `{ env: }` ref must name a variable set in the kiri process or the load fails with the offending key named — the same posture as a workflow referencing a missing bundle. Only *declared* refs are checked at load; conventional fallbacks resolve when a provider is used. Resolved key **values are never persisted, snapshotted, or echoed in errors** — the registry keeps only the env var's name.
- **Env source.** Kiri loads `.env` from the workspace root — the resolved config dir, not the launch cwd — at startup, so a workspace pinned via `KIRI_CONFIG_DIR` gets its own `.env` regardless of where kiri was launched from. The variables your `{ env: }` refs name resolve from there or the ambient environment. Existing variables win: an ambient export of the same name is left untouched, and an absent `.env` is a no-op.
- **Editor support.** Kiri publishes `.kiri/kiri.schema.json` on every launch, alongside the workflow schema, for YAML validation and autocomplete — map it the same way (modeline or `yaml.schemas`).
- **Workflows validate against it.** An `llm:` step's `model` is a `provider:model` id; the prefix must name a provider in this registry or the workflow fails to load — the same posture as a missing bundle.
- **Reloading.** Edits to `kiri.yaml` hot-reload while kiri runs, the same as `workflows/`. A valid change swaps the provider registry and re-validates workflows so `llm:` steps re-check their provider against the new set; an invalid edit is logged and the last-known-good providers are kept, so a mid-edit typo never breaks an in-flight session. Every settled reload — valid or not — publishes a `config.changed` event on the bus, so the in-app config-health panel and model picker refresh live as you edit (an invalid edit included, so a newly introduced error appears immediately).
- **Configuration health, surfaced not enforced.** Kiri reports configuration health rather than blocking on it — warn-and-continue, never failing boot. "Required" is contextual: an `sh:`/`use:`-only workspace needs no providers, so *no providers* is a degraded note, not an error; a declared provider whose API key is unset (including the conventional `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` fallback) is an error; an unparseable `kiri.yaml` is an error; a declared MCP server whose `{ env: }` ref is unset is an error, naming the server. The report is printed at startup and served at `GET /api/config/health`; the web app renders the non-ok checks as a banner atop the activity page (degraded as a warning, error as a problem). Per-provider model-listing failures from `GET /api/models` — a provider down or unauthorised — surface in the session model picker alongside the gap they explain.

### LLM step execution

An `llm:` step runs as a single non-streaming completion inside the kiri process — nothing is spawned. The runner renders the prompt template, calls the model through the provider registry, and maps the result onto the standard step envelope:

- **Prompt rendering.** Same `{{VAR}}` semantics as the script bundles' renderer (ASCII `[A-Z_][A-Z0-9_]*` names, one left-to-right pass, unknown names resolve to empty, substituted values never re-scanned), so existing bundle prompt templates port to `llm:` steps unchanged. The vars map is the step's env scope — its own `env:` plus the kiri-injected vars (`KIRI_RUN_ID`, `KIRI_STEP_INDEX`, `KIRI_REPO_ROOT`) — and `{{KIRI_INPUT}}` carries the previous step's stdout with one trailing newline trimmed, exactly what a bundle's `KIRI_INPUT="$(cat)"` sees.
- **Envelope mapping.** The completion text becomes `output` and `traces.stdout`; `traces.stderr` stays empty — there is no second stream. Token counts from the response are persisted on `traces.usage` (input/output/total, fields omitted when the provider doesn't report them). A provider or API error fails the step with the provider's message; halt-on-failure semantics match every other step.
- **No file channels.** A completion can't read or write files, so llm steps are not offered `KIRI_RECOMMENDATIONS_FILE`, and llm `publish:`/`summarize:` entries get the run envelope inlined as `{{KIRI_RUN_CONTEXT}}` instead of a `KIRI_RUN_CONTEXT_FILE` path — no context file is written for them. The inlined JSON caps each step's stdout/stderr at 64 KB (`[truncated]` marker) so a verbose step can't blow the model's context window; the context file bundle steps read is built by the same serialiser and carries the same caps.
- **Zero-config summariser.** A `summarize: { llm: { model } }` entry that declares neither `prompt` nor `prompt_file` falls back to a baked-in feed-summary prompt reading the inlined envelope. The fallback is applied at execution time only — the run's definition snapshot keeps what was authored.
- **Cancellation.** Cancelling a run aborts the in-flight HTTP request; the step and run finalise as `cancelled` through the same path as a killed child process.

Scope is completion-shaped steps: one prompt in, text out. Agentic work — tool use, multi-turn conversation — is **not** a workflow step: it lives in the separate agentic sessions pillar (see *Agentic sessions*). A workflow that wants a one-shot completion uses an `llm:` step; anything multi-turn or tool-driven is a session, not a step. (A `claude-code` script bundle remains a legitimate way to run an agent *inside a workflow step*, but that's a user-authored bundle, not kiri driving an agent loop.)

### Claude Code via the `claude-code` bundle

Kiri integrates with Claude Code through a `claude-code` script bundle — a worked example carried in the repo's `examples/` that the user copies into their workspace's `bundles/` and owns from then on. Kiri itself has no CC-specific code; the bundle does the spawning, config translation, transcript parsing, and meta emission. Spawning CC's CLI directly keeps Max subscription billing in play — the Agent SDK is API-billed only and not on the table for this personal tool.

Bundle layout (`examples/bundles/claude-code/`):

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

The bundle is plain bash — readable, modifiable, replaceable. Adding LM Studio support is `cp -r examples/bundles/claude-code bundles/lm-studio` and editing. The example lives in the repo; the user owns their copy from there.

### Output validation (for LLM steps producing structured output)

Three tiers, in order:

1. Use structured output / tool use at the API level. Kills ~95% of "wrapped in backticks" failures.
2. Validate against Zod schema. On failure, one-shot retry with the validation error fed back into the prompt.
3. *Optional* dedicated cleanup model — constrained to format-level repairs only. Stripping backticks: safe. Reshaping prose into fields: not safe.

### Cost tracking

First-party `llm:` steps persist token usage on their step row (`traces.usage`, straight off the provider response) — the numbers arrive without any side-channel, superseding the rationale for the retired `KIRI_META_FILE` meta channel where first-party calls are concerned. No cost/billing UI is built on top of them; the counts are simply kept.

Bundle-spawned agents (e.g. `claude-code`) still have no usage capture. The earlier design's generic meta channel (`KIRI_META_FILE` emitting `{ cost_usd, tokens_in, tokens_out, model }`) was retired unread to keep the runtime contract honest; if bundle-side numbers are ever wanted, that means re-introducing a transport plus UI promotion, with ccusage's transcript-parsing approach as the reference.

### Permissions philosophy

Static policy per step via `ALLOWED_TOOLS` in the workflow's `env:`. The `claude-code` bundle's `run.sh` synthesises a `.claude/settings.json` at spawn time and points CC at it — so the workflow YAML is the load-bearing source of permission truth, no hand-edited settings files anywhere in the user's repo. **No runtime hooks for v1.** Hooks are reserved for if/when dynamic per-call policy is wanted (token budget caps, mid-session escalation, tool-granular propose-to-approve).

For workflows using broad `Bash(*)` permissions, the load-bearing defence is the static `ALLOWED_TOOLS` allowlist on the step itself, plus the user's own claude config. Kiri does not wrap steps in a kernel sandbox: bundles are user-authored scripts in the user's own repo, with the same trust posture as any shell script they'd run themselves. If a bundle-install mechanism is ever added (a marketplace, `kiri install <bundle>`, etc.), revisit — the trust boundary changes at that point.

## Agentic sessions

The second pillar. Where a workflow is a fixed pipeline, an **agentic session** is a multi-turn conversation with a model that can reason, call tools, and stream its response. It is *not* built on the workflow engine and shares none of its execution model — only the surrounding infrastructure (config dir, SQLite, event bus, LLM provider registry) and the activity feed.

The pillar holds the **app-active and single-user invariants** unchanged: a session runs while the app is open, in-process, foreground, user-driven, and cancellable. A "running" session is an in-flight turn, exactly like a "running" run — there is no background agent, no overnight loop, no daemon turning the crank while the user is away.

### System prompt: core, `kiri.md`, and personas

A session's behaviour is shaped by a layered system prompt, composed fresh on every turn from up to three layers:

- **The kiri core layer** — immutable, authored by kiri itself. States the model's identity and the environment it runs in (a local-first, single-user tool; an interactive multi-turn chat; the current date), that replies render as GitHub-flavoured markdown with inline Vega-Lite `chart` blocks and `mermaid` diagrams (the same renderer the published articles use) — a chart when the point is the numbers, a diagram when it's the structure, and neither for ordinary prose — and that quoted file/web/tool/external text is untrusted data, not instructions. When the session has tools active it adds a brief, generic nudge to use them rather than guessing — each tool carries its own name and description from its MCP server, so the core layer needn't enumerate them. Composed per turn rather than held as a constant because it states the live date and the active tool set.
- **`kiri.md`** — an optional workspace-root markdown file of standing instructions, applied to every session when present: the user's always-on "how I want sessions to behave."
- **A persona** — an optional `personas/<name>.md` overlay, attached per session and injected after `kiri.md`, for putting a session into a specific role. Not applied by default.

Layers compose in order — **core → `kiri.md` → persona** — and all three are read fresh from disk each turn, so an edit takes effect on the next turn with git as the source of truth; nothing is snapshotted. A missing `kiri.md` and no persona is a first-class default: the session runs on the core layer alone, a plain chat.

This deliberately replaces an earlier `agents/*.yaml` registry idea (a pre-baked definition bundling system prompt, model, tools, and params, snapshotted onto the session). For a single-user tool, one always-on `kiri.md` plus opt-in personas covers role-switching without a registry, a watcher, or a per-session config snapshot. The model is chosen at session creation and swappable mid-conversation; the persona is likewise attached and swappable from the session's aside — a nullable `persona` column on the `sessions` row records the selection, the same posture as `model` — applying from the next turn.

### Storage

Two new tables alongside the existing four, following the runs/run_steps shape:

- **`sessions`** — one row per conversation: chosen model, the attached persona (a `personas/<name>.md` name, or null for none), status (`running` | `idle` | `failed` | `cancelled`), timestamps, and a **running token total** (see *Usage* below).
- **`messages`** — one row per message, child of `sessions`, ordered. Each message stores its role and an array of **AI SDK `UIMessage` parts** as JSON — text, tool-call, tool-result, file/image, reasoning. Per-message token usage rides on the row as JSON, mirroring `traces.usage`.

**Messages are stored as `UIMessage` parts, canonical and provider-agnostic** — this is the load-bearing early decision. Because parts already model tool calls and file/image attachments, adding tools and adding image uploads become *storage no-ops*: they are simply additional part types that were always persistable. Round-tripping to the model uses the SDK's `convertToModelMessages(history)`.

Large blob payloads (e.g. pasted image bytes) follow the same guidance as workflow traces: inline in SQLite to start, move to disk-backed blobs in `.kiri/` referenced by path only when payload size starts dragging feed queries. Decision deferred until it bites.

### Execution & streaming

A turn runs in-process against the provider registry — the same registry and `{ env: }` secret resolution as `llm:` steps — and is cancellable through the existing `CancelRegistry` (a turn, or a tool loop within a turn, is the cancellable unit). A turn is cancelled *only* by an explicit request (or swept to `failed` on restart): once started it runs to completion regardless of the client connection. Its streamed response is drained server-side, so navigating away, reloading, or dropping the connection leaves the turn running and persisting — the client reflects and reconciles it on return rather than the disconnect killing it. Two transports, each for what it is good at:

- **Per-turn token stream.** The turn endpoint returns the AI SDK's streamed response (`streamText(...).toUIMessageStreamResponse()`); the client renders tokens live via `@ai-sdk/react`'s `useChat`. The SDK owns the streaming protocol and the multi-step tool loop, which keeps kiri's bespoke surface small.
- **Coarse lifecycle on the existing SSE bus.** `session.*` events (started, turn added, idle, finished, deleted) ride the in-process event bus as thin cache-invalidation signals, exactly like `run.*`. **Token deltas do not go through this bus** — it is a status channel, and per-token fan-out is the wrong load for it.

On turn completion the new messages and their usage are persisted, and the session's running token total is updated.

### Tools

Tools are offered to a session's model through the AI SDK's tool loop. They are emphatically **not script bundles**: bundles are a workflow concept and the two pillars do not cross over. When a session has any tools, the turn runs as a **capped multi-step loop** — the model calls a tool, reads its result, and continues before answering — and the calls and results persist as `UIMessage` parts (a storage no-op, since messages were always stored as parts) and render in the transcript as a collapsed block showing what was called, with what, and its result (untrusted data, shown as formatted JSON, never markdown).

A session's tools come from **MCP servers** the user declares under `mcp:` in `kiri.yaml`, keyed by name — a `stdio` server kiri spawns as a subprocess, or an `http` server it connects to over Streamable HTTP. An http server authenticates either with static request headers (e.g. `Authorization`) whose values are `{ env: }` refs, or — with `auth: oauth` — through an OAuth browser sign-in kiri runs on demand, persisting the tokens to `.kiri/mcp-credentials.json` (mode 0600, a file separate from the feed DB so secrets never touch queryable data). Those OAuth tokens are the one secret class that isn't an `{ env: }` ref; every other secret stays an env ref, never a literal. Kiri connects each server at boot and on `kiri.yaml` reload, discovers its tools, and offers them to the model **namespaced `<server>__<tool>`** so names never collide. Tools flow through `@ai-sdk/mcp`, whose client returns AI-SDK tools directly; an OAuth server's transport is swapped for the official `@modelcontextprotocol/sdk`'s Streamable-HTTP transport, whose OAuth resolves the discovery quirks of real servers (trailing-slash issuers, cross-host authorization servers) that `@ai-sdk/mcp`'s does not. This generalises the tool model's self-gating: a server's tools are offered only when it is configured and connects — a server whose declared env ref is unset, that fails to connect, or whose OAuth isn't signed in yet, is simply absent, the reason surfaced as a config-health check (an unsigned-in OAuth server as a one-click **Connect** prompt). There is **no tool config beyond the server list and no approval/permission model** — configuring a server is the trust decision, the same posture as reading a bundle before you `use:` it (and an MCP `stdio` server is arbitrary-subprocess-equivalent, so it warrants the same care). The core system prompt frames tool output as untrusted data and gives a generic nudge to reach for the available tools; each MCP tool carries its own name and description from the server. Provider note: the OpenAI provider is wired to Chat Completions (`.chat()`), so tool-calling parity there is worth re-verifying as providers change. There are no first-party tools today — web search, for instance, is the Tavily MCP server plugged in like any other; first-party file and *run-a-workflow* tools (the single sanctioned bridge to the other pillar) may join the MCP-provided catalogue later.

### Usage & context

Sessions deliberately diverge from the workflow pillar's "usage lives only in per-step traces" stance (a dedicated usage column was once dropped there for lack of a reader). An agent loop genuinely needs **budget visibility** — cumulative input/output tokens and proximity to the model's context window, surfaced on every turn and likely on the feed row. So sessions keep **both** per-message usage *and* a denormalised running total on the `sessions` row, justified by that concrete read pattern. The **context window** itself isn't stored — it's read live from the provider's model listing, the same `GET /api/models` the picker uses. Anthropic, OpenRouter, and vLLM report it inline; LM Studio reports it only on its native `/api/v0/models`, probed best-effort when the OpenAI-compatible listing comes up short; OpenAI reports nothing, so those models have no known window. The session aside shows the current fill as `current / limit` when the window is known, and a warning surfaces as the conversation nears it. Long-running context management (truncation/summarisation as a conversation outgrows the window) is its own concern, deferred.

### Activity feed

Sessions are activity and belong in the feed. The home feed is a polymorphic union over `runs` + `sessions`, newest-first by `startedAt` with a composite `(startedAt, id)` cursor, fronted by an `All · Workflows · Sessions` tab strip that filters it to either kind. The filtered tabs reuse the per-kind `runs` and `sessions` feeds, so only the union carries the composite cursor.

## UI

- **Left rail: navigation.** `Activity` (the home feed), `Workflows` (the catalog), a one-click **+ New session** action, then the documentation links and version footer. Below the `lg` breakpoint the rail collapses to a top bar (wordmark + menu button) that opens the same nav in a left drawer.
- **Center: blended activity feed.** A reverse-chronological log of both workflow runs and agentic sessions, interleaved newest-first and day-grouped, behind an `All · Workflows · Sessions` tab strip (deep-linked via `?view=`). A run row shows workflow name, status, duration, and (when present) the run's one-or-two-sentence summary plus a stacked list of published articles — one row per article, each carrying the publish-entry name and (when present) the article body's first markdown `# heading` as a sub-byline so identically-titled articles from the same workflow are distinguishable — and a small count when it carries recommendations. A session row shows its status, model, turn count, token total, and a preview of its first message. Clicking a run row opens the run detail page (`/runs/:id`) with full traces, the run's recommendations, and its published articles; a session row opens its chat (`/sessions/:id`); an article entry opens its dedicated page (`/runs/:id/published/:slug`).
- **Workflow catalog (`/workflows`).** A searchable grid of every registered workflow, grouped by `group:`, each a launchable card showing its description and last-run status — the home for starting a workflow.
- **Session chat (`/sessions/:id`).** The conversation transcript with a composer, and a right rail carrying the session's model — swappable mid-conversation, applying from the next turn — its running token totals, and current context fill.

Home has no right rail; per-route marginalia (an article's table of contents, a run's Published section) appears only where a route has it. Cost visibility is deferred (see *Cost tracking* above).

## Application stack

The orchestrator is a single Node process serving both the engine and the UI. The user "uses the app" by visiting a local URL in their browser; the process keeps running regardless of whether that browser tab is open.

### Stack

- **Bun** — runtime. TypeScript runs natively (no separate compile step), `bun:sqlite` is statically linked (no native-module headache), and `bun build --compile` produces a single-file macOS binary — the release artifact for distribution. One toolchain for install, test, run, and build.
- **Hono** — HTTP server, SSE streams. Runtime-agnostic by design but pairs cleanly with Bun via `Bun.serve`. The Hono process *is* the orchestrator daemon: runs the cron tick loop, executes workflows, serves the UI bundle. One process, clear ownership.
- **Vite + React** — UI bundle, served by Hono. No SSR, no framework magic — just a SPA window into the daemon. `wouter` for routing — tiny and hook-based.
- **SSE** for live feed updates. One-way (server → client), browsers handle reconnection natively, Hono has `streamSSE` built in. WebSockets reserved for if/when bidirectional streaming is actually needed.
- **TanStack Query** for client state. The SSE bus carries thin events (a type plus ids); the client treats them as cache-invalidation signals — an event invalidates the affected query and React Query refetches — rather than hand-rolling per-surface refetch wiring. Shared data hooks live in `client/state/`; UI features under `client/features/` compose the design-system primitives, and each route renders its own page shell (left nav · main · right marginalia) rather than an app-level wrapper.
- **bun:sqlite + Drizzle** for state (see *State storage* under Architecture). Drizzle's `drizzle-orm/bun-sqlite` adapter; schema and migrations identical to a Node + better-sqlite3 setup.

No Next.js, no HonoX, no full-stack framework — explicit choice to keep UI and daemon as separate layers communicating over HTTP/SSE.

### Launch model & data dir

Kiri is a CLI launched from the cwd of whichever directory you want to run workflows against. The tool is global; the directory is the workspace. Same shape as `vite`, `next dev`, `drizzle-kit` — switching projects is `cd && kiri`, or set `KIRI_CONFIG_DIR` (a leading `~` is expanded) to pin a fixed workspace for launchers and aliases that can't easily `cd` first. There is no global cross-repo store. Workflow definitions are expected to live under git, but kiri itself doesn't enforce that — the user owns versioning their own definitions.

Repo-scoped runtime state lives in `.kiri/` at the repo root, gitignored:

```
<repo-root>/
  workflows/                  # YAML workflow definitions (in git)
  kiri.yaml                   # structured config: LLM providers, … (in git; optional)
  bundles/                    # script bundles (in git)
    claude-code/              # an example bundle copied in; user owns it
      run.sh
      README.md
    <other-bundles>/...
  prompts/                    # CC prompt templates (in git, convention only — any path works)
  .kiri/                      # gitignored — repo-scoped runtime state
    state.db                  # SQLite
    runs/<id>/                # per-run scratch dirs
    mcp-credentials.json      # OAuth tokens for MCP servers (mode 0600; separate from state.db)
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
- **Per-step env scope.** Steps only see env vars from the step's `env:` block plus a small kiri-controlled set (`KIRI_RUN_ID`, `KIRI_STEP_INDEX`, `KIRI_REPO_ROOT`) and the OS essentials (`PATH`, `HOME`, `USER`, `LOGNAME`). No other parent-process env leaks through.
- **Env precedence at spawn.** User-declared `env:` is applied first; kiri- and OS-controlled vars overwrite on key collision. A workflow can't redirect `PATH` to inject a malicious binary or shadow `KIRI_RUN_ID` to confuse run identity.
- **Reserved namespace.** `env:` keys starting with `KIRI_` are rejected at workflow load time as a schema error. Typos and accidental collisions surface as load failures, not silent overwrites at spawn.
- **Resource limits.** ulimits on CPU time, memory, file descriptors, and disk writes. A runaway script halts cleanly rather than degrading the system.
- **No kernel sandbox.** Bundles run with the user's permissions. The trust posture is "scripts you authored or pasted into your own repo, same as any shell script you'd run yourself" — sandbox-wrapping every step is cost without protection in that model. The defence here is `ALLOWED_TOOLS` on the step plus reading the bundle before you use it.

### AI integration

- **Assume prompt injection.** PR bodies, issue text, file contents reaching an agent's prompt may attempt to redirect its behaviour. The permission allowlist is the load-bearing defence — even a fully compromised agent can only do what the step's `ALLOWED_TOOLS` declares. Prompt-level mitigations (system prompt framing) help but aren't relied on as primary defence.
- **Conservative allowlists.** Adding `Bash(*)` to any step's allowlist requires a deliberate decision, never a quick fix to "make it work."

### Secrets

- **No secrets in workflow definitions.** Definitions are git-tracked. Secrets stay outside the repo, mode 600, referenced by name from the workflow.
- **No secrets in LLM provider config.** `kiri.yaml` is git-tracked, so an `api_key` is an `{ env: <NAME> }` reference only — a literal key is a schema error. Resolved values are never persisted, snapshotted, or echoed in errors (see *AI integration → LLM providers*).
- **MCP OAuth tokens are the one persisted-secret exception.** An `auth: oauth` MCP server's tokens are written to `.kiri/mcp-credentials.json` — gitignored, mode 0600, and a *separate* file from the state DB so secrets never land in queryable feed data. The trusted-local-machine threat model justifies on-disk tokens; the store sits behind a small interface so an OS keychain is a later swap. The OAuth callback (a top-level provider redirect, so a GET that can't carry the `X-Kiri-Client` header) is the one state-changing endpoint exempt from that CSRF gate — defended instead by the OAuth `state` parameter, which kiri validates against the value it persisted at sign-in start.
- **No secrets in feed entries or traces.** Output rendering scrubs known secret patterns (tokens, AWS keys, etc.) before display and persistence.

### UI

- **All script and AI output is treated as untrusted.** No untrusted markup reaches the DOM without passing a sanitiser first. Markdown rendering uses a hardened parser with no raw-HTML pass-through — `dangerouslySetInnerHTML` is not used to inject parser output. The single place markup is embedded directly is a diagram's SVG, and only *after* a sanitiser has run over it (see *Mermaid diagrams*).
- **Charts carry no raw-HTML surface.** Fenced `chart` blocks in article markdown render Vega-Lite specs as SVG through that same parser — no `dangerouslySetInnerHTML`. Vega's data loader is locked to inline values, so a chart spec from untrusted article content cannot trigger a network fetch.
- **Mermaid diagrams are sanitised before embedding.** Fenced `mermaid` blocks render through mermaid in `strict` security mode, which runs the produced SVG through DOMPurify — stripping scripts and event handlers — before it is embedded inline. A malformed or hostile diagram degrades to an inline notice rather than breaking the article. The renderer offers a *source* view of the raw diagram text alongside the rendered diagram.
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
- Global todo / inbox surface for cross-workflow proposed actions (recommendations attach to the producing run only)
- Dynamic per-call permission policy (static per step only)
- Persistent execution across app restarts (graceful halt on close, manual re-run on reopen)
- Custom DSL for workflows
- Agent-driven *workflow* control — workflows stay deterministic linear pipelines; no agent decides which step runs next. (Agentic behaviour is a separate pillar, see *Agentic sessions* — it does not reach into the workflow engine.)
- Publishing to external destinations (gist, git commit, webhook POST); `publish:` is in-app only for v1

Deliberately not built (single-user ephemeral local tool): audit logs, on-host HTTPS/TLS (the `https://local.kiri.build` shell is hosted, not on-host), `ulimit`/resource caps and kernel sandboxing of step execution, and a general secret store (secrets are env-var `{ env: }` refs). The one exception is MCP OAuth tokens, which *are* persisted — in a mode-0600 `.kiri/mcp-credentials.json` — because a browser sign-in has nowhere else to put them; a broader keychain-backed store stays out of scope until it's needed.

## Phased build

Sequenced for fastest path to dogfooding, then layering capability outward. Each phase a usable artifact.

**Shipped:**

1. **Spine.** YAML-defined linear pipeline of script steps. Standard envelope, traces captured, run history persisted to SQLite via Drizzle. Feed UI renders run history.
2. **Step schema migration.** YAML moved to `steps:` with `use:` (bundle reference) or `sh:` (inline shell), plus per-step `env:` with precedence and reserved-namespace rules.
3. **`claude-code` bundle starter.** A working CC runner bundle that translates `env:` keys to CC flags, spawns `claude`, and captures the session.
4. **Hosted shell.** `https://local.kiri.build` — a static Cloudflare Pages shell that loads the locally-running kiri's bundle. Stable bundle paths, CORS allow-list.
5. **Security baseline.** Bind to `127.0.0.1` only; require `X-Kiri-Client` header on state-changing endpoints — shuts down cross-origin attacks from other browser tabs.
6. **UX foundation + test infra.** Tailwind v4; `wouter` router with `/` and `/runs/:id`; `bun:test` + `happy-dom` + `@testing-library/react`; Playwright golden-path e2e.
7. **Live updates, toasts, cancel.** In-process event bus, SSE endpoint, EventSource cache invalidation, completion toasts, in-flight cancel.
8. **Activity feed summaries.** Workflow-level `summarize:` field, `claude-code-summarizer` bundle, summary rendered in feed and at the top of run detail.
9. **Onboarding & docs.** Hosted-shell fallback when no local kiri is running, one-sheet docs site at `/docs`, in-app link.
10. **Configurable summariser.** `PROMPT` / `PROMPT_FILE` / `MODEL` / `MAX_TURNS` env support on `claude-code-summarizer` with defaults preserved; `PROMPT` added to `claude-code` with precedence over `PROMPT_FILE`.
11. **Cursor-based feed pagination.** Infinite-scroll feed; live updates and cold-load cost decoupled from total run count.
12. **Article publishing.** `publish: [...]` array on workflows. Markdown articles stored in `articles`, surfaced as a stacked list on each feed row and a "Published" section on run pages, opened on dedicated `/runs/:id/published/:slug` pages via a sandboxed renderer.
13. **Workflow inputs.** `inputs:` block on workflows — named parameters collected via a modal on invoke, snapshotted onto the run, and injected into step `env:` via `{ input: <name> }` refs. One definition, many targets.
14. **Recommendations.** Workflows emit follow-up workflow invocations via a `KIRI_RECOMMENDATIONS_FILE` file channel. Stored as rows linked to the producing run, surfaced on the run detail page as a "Recommended" section beneath the run's phases, and triggered via the standard invoke modal with inputs pre-filled.
15. **First-party LLM steps.** An `llm:` step kind that runs a model completion in-process against a provider declared in `kiri.yaml` (`provider:model` ids, `{ env: <NAME> }` API-key refs). Inline or file prompts with the bundles' `{{VAR}}` templating — `{{KIRI_INPUT}}` for pipeline steps, the inlined `{{KIRI_RUN_CONTEXT}}` for publish/summarise — token usage on the envelope, and a zero-config `llm:` summariser. The bundle-free path for completion-shaped steps; the model, prompt source, and token counts render across the run timeline and workflow schema surfaces.
16. **Agentic sessions.** The second pillar (see *Agentic sessions*) — multi-turn agentic chat against a model declared in `kiri.yaml`: streaming turns, cancel and resume, per-session token totals, one-click session creation, and a mid-conversation model swap. Sessions join workflow runs in the blended activity feed.
17. **Session system prompt.** A layered system prompt for sessions (see *Agentic sessions → System prompt*): an immutable kiri core layer (identity, environment, markdown + chart + diagram rendering, untrusted-content framing), a workspace-root `kiri.md` of standing instructions, and optional `personas/<name>.md` overlays attached per session and swappable from the session aside. Composed fresh each turn (core → `kiri.md` → persona); the attached persona rides a `persona` column on the `sessions` row.
18. **Session tools — web search and extract.** The session tool loop (see *Agentic sessions → Tools*): tools plug into the AI SDK tool loop, with calls and results persisted as message parts and rendered inline in the transcript as a collapsed block, and the core prompt gains tool nudging plus chart/diagram restraint. The first tools were Tavily-backed **web search** and **web extract** — later removed in favour of MCP (see below).
19. **MCP server support.** Agentic sessions gain tools from **MCP servers** declared under `mcp:` in `kiri.yaml` — `stdio` subprocesses or `http`/Streamable-HTTP endpoints, secrets as `{ env: }` refs. Kiri connects each at boot and on config reload via `@ai-sdk/mcp`, namespaces their tools `<server>__<tool>`, and offers them to the session model; connection status surfaces as config-health checks.
20. **Retire first-party web tools.** The Tavily-backed web search/extract tools and the built-in tool seam are removed; the session tool catalogue is MCP-provided. Web search is now an MCP server the user plugs in (the Tavily MCP server) rather than a first-party tool.
21. **OAuth-authenticated MCP servers.** An `http` MCP server can set `auth: oauth` to authenticate by a browser OAuth sign-in instead of a static header. Kiri runs the flow — dynamic client registration, PKCE, refresh — through the official `@modelcontextprotocol/sdk`'s Streamable-HTTP transport (robust against real servers' discovery quirks where `@ai-sdk/mcp`'s OAuth is not), fed into `@ai-sdk/mcp`'s client so tools still arrive as an AI-SDK ToolSet. Tokens persist in a mode-0600 `.kiri/mcp-credentials.json`; a server awaiting sign-in surfaces as a one-click **Connect** prompt in the activity view and reconnects live on completion.

## Open questions

- **Trace retention policy.** How long do verbose traces and CC transcripts stay in SQLite before pruning? Size-cap, time-cap, or both? Decision triggers the disk-blob split.
- **Secret store mechanism.** Resolved for the case that forced it: MCP OAuth tokens persist in a mode-0600 `.kiri/mcp-credentials.json` behind a small store interface (an OS keychain is a swap behind it). Other secrets stay env-var `{ env: }` refs. Still open is whether a broader keychain / 1Password integration is worth the friction for those — revisit if env-only secrets become painful.

## Prior art (reference, not imitation)

- **Windmill** — closest "shape" minus the feed-first UX
- **Kestra** — declarative + git sync, more CI-flavoured
- **n8n** — graph-first UX
- **Rivet** — visual AI flows in Electron
- **Inngest / Trigger.dev** — event-driven dev primitives, cloud-oriented
- **Huginn** — old Ruby agents project that originated the "feed of events" model
-
