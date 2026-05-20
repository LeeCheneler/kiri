# Kiri — Workflow Authoring Reference

Drop this file into a kiri workspace (or copy it into the workspace's `CLAUDE.md`) so an AI assistant has full context on how to write workflows, bundles, prompts, and `publish:` / `summarize:` steps without hunting around for the schema.

Kiri is a **local-first, git-based workflow orchestrator**. A workflow is a linear pipeline of shell steps. The previous step's stdout becomes the next step's stdin. Workflows are YAML, bundles are bash scripts on disk, prompts are plain text templates.

> **One rule that bites people early:** kiri runs steps with a **scoped env**. Nothing from the parent shell is inherited. If a step needs `MY_TOKEN`, set it explicitly under that step's `env:`. The exceptions are `PATH`, `HOME`, `USER`, `LOGNAME`, and the `KIRI_*` vars kiri injects.

---

## Workspace layout

```
<repo-root>/
  workflows/                  # YAML workflow definitions (in git)
    my-workflow.yaml
  scripts/                    # script bundles (in git)
    claude-code/              # shipped by `kiri init`
      run.sh
      README.md
    claude-code-summarizer/   # shipped by `kiri init`
    <your-bundle>/
      run.sh                  # required, executable
      README.md               # documents the env-var contract
  prompts/                    # convention only; any path under repo works
    my-prompt.tpl
  .kiri/                      # gitignored — runtime state
    state.db                  # SQLite (Drizzle-managed)
    runs/<run-id>/            # per-run scratch dir (auto-cleaned after run)
    workflow.schema.json      # JSON Schema for editor LSP
```

`workflows/` is scanned top-level only — nested YAML files are ignored by design. The scan runs at startup and (in dev) on file change.

---

## Workflow YAML — full schema

```yaml
# yaml-language-server: $schema=../.kiri/workflow.schema.json   # editor LSP

name: My Workflow            # required, unique across workflows/
schedule: "*/15 * * * *"     # optional, cron expression (M7 — not wired yet)
gating: auto                 # optional: "auto" | "propose" (M8 — not wired yet)

steps:                       # required, ≥1
  - use: <bundle-name>       # references scripts/<bundle-name>/run.sh
    description: "..."       # optional, surfaced in UI
    env:                     # optional, flat string→string map
      KEY: "value"

  - sh: |                    # OR inline shell — sugar for one-shots
      set -eu
      echo "anything"
    description: "..."       # optional
    env:
      OTHER: "value"

publish:                     # optional, M6 — long-form markdown artefacts
  - name: digest             # required, kebab-case-only ([a-z0-9-]+), unique within workflow
    title: "Friendly Title"  # optional, shown on feed/run page (defaults to a humanised name)
    description: "..."       # optional
    use: claude-code         # OR sh: |  …  — same shape as a step
    env:
      PROMPT_FILE: prompts/digest.tpl

summarize:                   # optional — one-shot post-run summary
  use: claude-code-summarizer
  env:                       # optional override (see bundle docs)
    MODEL: sonnet
```

### Step shape rules

A step is **exactly one** of:

- `{ use: <name>, description?, env? }` — resolves to `scripts/<name>/run.sh`. Missing bundle → workflow fails to load with a clear error.
- `{ sh: <string>, description?, env? }` — inline shell, run via `sh -c`. Use YAML's `|` block scalar for multi-line.

Mixing `use:` and `sh:` on the same step is a schema error.

### `env:` rules

- Flat `string → string` map. **All values must be strings.** Numbers/booleans must be quoted: `MAX_TURNS: "50"`, not `MAX_TURNS: 50`.
- Keys starting with `KIRI_` are **rejected at load time**. That namespace is reserved.
- User env is applied **first**, then `PATH`, `HOME`, `USER`, `LOGNAME` from the kiri parent process, then `KIRI_*` overlays. A workflow can't shadow `PATH` or `KIRI_RUN_ID`.

### `publish:` rules

- Each entry runs after `steps:` complete (on `ok` and `failed` runs, not `cancelled`). One after another, serially.
- Each entry's **trimmed stdout** is stored as a markdown artefact, keyed by `name`. It appears as a chip on the feed and a "Published" entry on the run detail page, with its own `/runs/:id/published/:name` view rendered through a sandboxed markdown parser.
- `name` must match `^[a-z0-9-]+$` and be unique within the workflow.
- A failing publish step does **not** fail the run — siblings still run. (Exception: cancel mid-publish flips the run to `cancelled` and halts further publishes.)

### `summarize:` rules

- Runs **after** publish entries, only on non-cancelled runs.
- Its trimmed stdout becomes the run's `summary` (rendered on the activity feed row and at the top of the run detail page).
- Failure is non-fatal — `runs.status` stays whatever `steps:` decided.
- Empty stdout leaves `summary` null.

---

## How data flows between steps

```
steps[0] stdin = ""               steps[0] stdout ─┐
                                                   ▼
steps[1] stdin = steps[0] stdout  steps[1] stdout ─┐
                                                   ▼
steps[2] stdin = steps[1] stdout  steps[2] stdout
```

- `steps[0]` receives empty stdin.
- Every subsequent step receives the **previous step's full stdout** on stdin.
- `publish:` and `summarize:` steps receive **empty stdin**. They read the run via `KIRI_RUN_CONTEXT_FILE` instead (see below).
- A non-zero exit code on any step in `steps:` halts the pipeline. Later `steps:` are skipped; `publish:` and `summarize:` still run.

---

## Environment kiri injects into every step

| Var | Value |
| --- | --- |
| `KIRI_RUN_ID` | UUID of this run. |
| `KIRI_STEP_INDEX` | 0-based index of this step within the run. Publish entries continue numbering after the last regular step. |
| `KIRI_REPO_ROOT` | Absolute path of the workspace root (where `kiri` was launched). Resolve all relative paths (`prompts/foo.tpl`, etc.) against this. |
| `KIRI_BUNDLE_DIR` | Absolute path to the bundle's own dir (e.g. `<root>/scripts/<name>/`). **Only set for `use:` steps** — sh-steps don't have a bundle. |
| `KIRI_RUN_CONTEXT_FILE` | Absolute path to a JSON file with the run envelope so far. **Only set for `publish:` and `summarize:` steps.** |
| `PATH`, `HOME`, `USER`, `LOGNAME` | Inherited from the kiri parent process. |

Step working directory is the **per-run scratch dir** at `.kiri/runs/<run-id>/`, not the repo root. Use `KIRI_REPO_ROOT` to reach repo files.

---

## The run context JSON (`KIRI_RUN_CONTEXT_FILE`)

Written to the scratch dir before each `publish:` and `summarize:` step. Shape:

```json
{
  "workflow": "My Workflow",
  "status": "ok",                          // ok | failed | cancelled (at time of write)
  "startedAt": "2026-05-11T09:00:00.000Z",
  "durationMs": 12345,
  "steps": [
    {
      "kind": "sh",                        // "use" | "sh"
      "sh": "set -eu; ...",                // present if kind === "sh"
      "use": "<bundle>",                   // present if kind === "use"
      "index": 0,
      "status": "ok",                      // ok | failed | cancelled
      "durationMs": 123,
      "stdout": "...",
      "stderr": "...",
      "error": null
    }
  ],
  "artefacts": [
    { "name": "digest", "title": "...", "content_md": "..." }
  ]
}
```

`artefacts` is the **list of publish artefacts already produced when this step starts.** So:

- The first `publish:` entry sees `artefacts: []`.
- The Nth `publish:` entry sees artefacts 0..N-1.
- `summarize:` sees all artefacts.

The full per-step `stdout`/`stderr` is in there too — `publish:` and `summarize:` steps don't need to re-fetch the run.

### Reading the context: `KIRI_RUN_CONTEXT_FILE` vs `{{KIRI_RUN_CONTEXT}}`

Two ways to bring this JSON into a prompt, picked by what the model can do:

- **Agentic models that can open files** (e.g. Claude Code with the `Read` tool): reference `{{KIRI_RUN_CONTEXT_FILE}}` — the model opens the path itself. This is what `claude-code` / `claude-code-summarizer` do.
- **Non-agentic local models** (e.g. anything routed through `lm-studio-summarizer`): reference `{{KIRI_RUN_CONTEXT}}` — bundles in this class read the context file at the top of `run.sh` and expose its **content** as an env var, so the awk substitution pass splices the JSON directly into the prompt. Without this, a non-tool-using model leaks raw tool-call tokens into the response instead of reading the context.

`KIRI_RUN_CONTEXT` is a bundle-level convention, not a kiri-injected env var — only bundles that opt in (currently `lm-studio-summarizer`) expose it. If you author a bundle for a non-agentic runtime, expose the same placeholder by reading `KIRI_RUN_CONTEXT_FILE` into a `KIRI_RUN_CONTEXT` env var before the prompt-template substitution.

---

## Shipped bundles

`kiri init` drops two bundles in `scripts/`. Both spawn the Claude Code CLI under the hood, both use the same `{{VAR}}` templating, both are plain bash you can read and edit.

### `claude-code` — general-purpose CC step

```yaml
- use: claude-code
  env:
    PROMPT: "Summarise {{KIRI_INPUT}} in one sentence."   # one-of PROMPT/PROMPT_FILE required
    PROMPT_FILE: prompts/my-prompt.tpl                    # one-of PROMPT/PROMPT_FILE required
    MAX_TURNS: "50"                                       # optional, default "50"
    MODEL: opus                                           # optional, claude picks default
```

- `PROMPT` wins over `PROMPT_FILE` when both are set (no concat).
- `PROMPT_FILE` is resolved against `KIRI_REPO_ROOT` if relative.
- The previous step's stdout is exposed as `{{KIRI_INPUT}}` (one trailing newline trimmed).
- Tool permissions come from `~/.claude/settings.json` — this bundle does **not** synthesise its own. Constrain via prompt wording or your global claude settings.

### `claude-code-summarizer` — defaults sane, zero config

```yaml
summarize:
  use: claude-code-summarizer       # no env needed — uses baked-in prompt, MODEL=haiku, MAX_TURNS=50
```

Override knobs when you want shape:

```yaml
summarize:
  use: claude-code-summarizer
  env:
    PROMPT: "One witty sentence about {{KIRI_RUN_CONTEXT_FILE}}."
    PROMPT_FILE: prompts/my-summary.tpl   # alternative; PROMPT wins if both set
    MODEL: sonnet                          # default haiku
    MAX_TURNS: "50"                        # default 50
```

If no `PROMPT`/`PROMPT_FILE` is given, the bundle's baked-in prompt hands Claude the path `{{KIRI_RUN_CONTEXT_FILE}}` and asks it to `Read` the envelope agentically — the JSON is never inlined into the prompt argv, so runs that produce hundreds of KB of stdout don't push the prompt past macOS `ARG_MAX` or the model's input limit. The prompt then asks for a bullet list for list-style runs and a single sentence for one-shot runs.

### Prompt templating (both bundles)

`{{VAR}}` placeholders are substituted from the environment in a single left-to-right pass:

- Names: `[A-Z_][A-Z0-9_]*`.
- Unknown vars resolve to empty.
- Substituted values are **not** re-scanned — a value containing `{{X}}` stays literal.
- Available vars: `KIRI_INPUT`, `KIRI_RUN_ID`, `KIRI_STEP_INDEX`, `KIRI_REPO_ROOT`, `KIRI_BUNDLE_DIR`, `KIRI_RUN_CONTEXT_FILE` (for `publish:`/`summarize:`), plus anything in the step's own `env:` block.

Example template:

```
# prompts/greet.tpl
Say a {{TONE}} one-sentence hello to {{KIRI_INPUT}}.
```

```yaml
- sh: echo "Lee"
- use: claude-code
  env:
    PROMPT_FILE: prompts/greet.tpl
    TONE: cheerful
```

Renders: `Say a cheerful one-sentence hello to Lee.`

---

## Authoring a custom bundle

Add a folder under `scripts/<name>/` with `run.sh` + a `README.md` documenting its env-var contract:

```
scripts/my-bundle/
  run.sh
  README.md
```

`run.sh` is plain POSIX shell (bash is fine — must be executable). It receives the previous step's stdout on stdin and writes its result on stdout. Use stderr for diagnostics; stdout is the next step's input.

```sh
#!/bin/sh
set -eu

# Required from kiri
: "${KIRI_REPO_ROOT:?required (kiri injects this)}"
: "${KIRI_RUN_ID:?required (kiri injects this)}"

# Required from the workflow's env: block
: "${TARGET:?TARGET env var is required}"

# Read previous step's output (empty for first step)
input="$(cat)"

# Do the thing; stdout goes to the next step / artefact / summary
printf 'processed %s for %s\n' "$TARGET" "$input"
```

**Rules:**

- Exit `0` on success; non-zero on failure. The exit code is what kiri reads.
- Don't `cd` away from the scratch dir unless you mean to — kiri restores nothing.
- Anything you read from disk should be resolved against `$KIRI_REPO_ROOT`, not relative cwd.
- Document the env-var contract in `README.md` next to `run.sh`.
- Adding a fork? `cp -r scripts/claude-code scripts/my-bundle && $EDITOR scripts/my-bundle/run.sh`.

---

## Triggers

- **Manual** — click *Run* in the UI on `https://local.kiri.build` (or `http://localhost:4242`).
- **Cron** — `schedule:` field accepts a cron expression. (Wired in M7 — currently parsed but no in-process tick loop yet; check `docs/milestones.md` for current status.)

There are no file watches, webhooks, or inbox polling. Build polling on top of a cron-scheduled `sh:` step instead.

---

## Execution semantics

- Single global in-flight concurrency: only one run at a time across all workflows.
- A failing step in `steps:` halts the pipeline. `publish:` and `summarize:` still run; the run is marked `failed`.
- A failing `publish:` / `summarize:` doesn't change `runs.status`.
- Cancel from the UI sends `SIGTERM` then `SIGKILL` to the active child. A run cancelled mid-`steps:` skips remaining steps, publishes, and the summariser entirely.
- The per-run scratch dir at `.kiri/runs/<run-id>/` is removed when the run ends.

---

## The standard step envelope

Every step (regular, publish, summarize) produces:

```ts
{
  status: "ok" | "failed",
  output: string,           // captured stdout
  error?: { message, stack? },
  traces: { stdout, stderr, durationMs }
}
```

`status: "failed"` corresponds to a non-zero exit code. `stdout` is what flows downstream; `stderr` is captured for the run page but not piped onward.

---

## Worked examples

### 1. Single-step shell workflow

```yaml
# workflows/pr-review-queue.yaml
name: PR Review Queue
steps:
  - sh: |
      set -eu
      prs=$(gh search prs --review-requested=@me --state=open)
      if [ -z "$prs" ]; then
        echo "No PRs awaiting your review."
      else
        echo "$prs"
      fi
summarize:
  use: claude-code-summarizer
```

### 2. Shell → AI pipeline with a markdown artefact

```yaml
# workflows/hackernews-digest.yaml
name: HackerNews Digest
steps:
  - sh: |
      set -eu
      limit=10
      ids=$(curl -fsSL "https://hacker-news.firebaseio.com/v0/topstories.json" \
        | jq -r ".[:${limit}][]")
      printf '['
      first=1
      for id in $ids; do
        [ "$first" = 1 ] && first=0 || printf ','
        curl -fsSL "https://hacker-news.firebaseio.com/v0/item/${id}.json"
      done
      printf ']'
publish:
  - name: article
    title: HackerNews Top Stories
    use: claude-code
    env:
      PROMPT_FILE: prompts/hackernews-digest.tpl
      MODEL: sonnet
summarize:
  use: claude-code-summarizer
```

The `publish:` step's prompt reads `KIRI_RUN_CONTEXT_FILE`, parses `steps[0].stdout` (the JSON array of HN items), and formats markdown. Stdout becomes the artefact.

### 3. AI step consuming the previous step's stdout via `{{KIRI_INPUT}}`

```yaml
name: Idea Polisher
steps:
  - sh: echo "kiri makes personal automation calm"
  - use: claude-code
    env:
      PROMPT: |
        Rewrite this idea as a one-sentence tagline:

        {{KIRI_INPUT}}
      MAX_TURNS: "1"
```

### 4. Multi-publish workflow

```yaml
name: Daily Briefing
steps:
  - sh: |
      set -eu
      # fetch some upstream data, print JSON to stdout
      curl -fsSL https://example.com/api/today
publish:
  - name: summary
    title: Today, summarised
    use: claude-code
    env:
      PROMPT: "Read {{KIRI_RUN_CONTEXT_FILE}}, find steps[0].stdout, and write a 5-bullet markdown summary."
      MODEL: sonnet
  - name: full
    title: Full report
    use: claude-code
    env:
      PROMPT: "Read {{KIRI_RUN_CONTEXT_FILE}} and produce a long-form markdown report from steps[0].stdout."
      MAX_TURNS: "12"
summarize:
  use: claude-code-summarizer
```

The `full` publish step's `artefacts` array in the context file already contains the `summary` artefact — useful if you want one publish to build on another.

### 5. Custom bundle with a typed env contract

```
scripts/post-to-slack/
  run.sh
  README.md
```

```sh
#!/bin/sh
# run.sh
set -eu

: "${SLACK_WEBHOOK_URL:?required}"
: "${CHANNEL:=#general}"

body="$(cat)"
curl -fsSL -X POST -H 'Content-Type: application/json' \
  --data "$(jq -nc --arg t "$body" --arg c "$CHANNEL" '{channel:$c,text:$t}')" \
  "$SLACK_WEBHOOK_URL"
```

```yaml
# workflows/notify.yaml
name: Notify
steps:
  - sh: echo "deploy finished"
  - use: post-to-slack
    env:
      SLACK_WEBHOOK_URL: "https://hooks.slack.com/services/…"   # secret — see below
      CHANNEL: "#ops"
```

**Secrets** don't have a first-class store yet. For now, pull them from a mode-600 file inside the `sh:` step (or inside a bundle's `run.sh`) — keep them out of YAML and out of git.

---

## Trust model & guardrails

- Bundles and `sh:` steps run with **your user's permissions**. There's no sandbox. Read scripts before you run them, same as you'd read any shell script.
- HTTP API binds to `127.0.0.1` only and requires an `X-Kiri-Client` header on state-changing endpoints — guards against cross-origin attacks from other browser tabs.
- Workflow inputs from external sources (PR titles, issue bodies, HN items) are **untrusted**. Don't splice them into shell command strings — pass through env vars or stdin. The orchestrator does this for you; preserve it in your bundles.
- AI output is **untrusted data** when it flows to a downstream step. If an AI step's stdout becomes input to a shell step, treat it like any other external string.

---

## Common authoring mistakes

| Mistake | Fix |
| --- | --- |
| `MAX_TURNS: 50` (yaml number) | `MAX_TURNS: "50"` — `env:` values must be strings. |
| `env: { KIRI_MODE: "x" }` | Don't prefix keys with `KIRI_`. Reserved. |
| Relative path `prompts/foo.tpl` from inside a step expecting cwd-relative | Resolve against `$KIRI_REPO_ROOT`. The step's cwd is the scratch dir, not the repo root. |
| Reading the parent shell's `MY_TOKEN` | Won't work. Set it explicitly under the step's `env:` (or pull it from a mode-600 file inside the script). |
| Two `publish:` entries with the same `name` | Names must be unique within a workflow. |
| `publish:` step that depends on the previous step's stdout via stdin | `publish:` and `summarize:` get empty stdin. Read `KIRI_RUN_CONTEXT_FILE` instead. |
| Multi-line `sh:` without `set -eu` | `sh -c` doesn't stop on first failure by default. Start every non-trivial `sh:` with `set -eu`. |
| Using `dangerouslySetInnerHTML` in custom UI that renders artefacts | Don't. Artefacts render through a sandboxed markdown parser. AI/script output is untrusted. |

---

## Editor LSP

The JSON Schema at `.kiri/workflow.schema.json` is generated from the Zod schema and ships with each `kiri` run. Pin it at the top of each YAML file for in-editor validation:

```yaml
# yaml-language-server: $schema=../.kiri/workflow.schema.json
```

---

## Where to look in the codebase

If kiri's repo is the workspace and behaviour is unclear, these are the source-of-truth files:

- **Schema:** `src/server/workflows/schema.ts`
- **Loader (file scan, bundle resolution, error reporting):** `src/server/workflows/loader.ts`
- **Step execution (spawn, envelope, env scoping):** `src/server/runner/run-step.ts`
- **Run lifecycle (steps → publish → summarize, context JSON, cancel):** `src/server/runner/run-workflow.ts`
- **Architecture overview:** `docs/design-notes.md`
- **What's shipped vs. next:** `docs/milestones.md`
