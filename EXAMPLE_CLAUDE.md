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
    claude-code/
      run.sh
      README.md
    claude-code-summarizer/
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
description: "..."           # optional — one-line summary, shown as the workflow page deck
group: Dev                   # optional — grouping label; buckets the workflow in the side nav + shows as the workflow page eyebrow

inputs:                      # optional — parameters collected via a modal at invoke
  - name: pr_number          # identifier referenced from a step's env (`{ input: pr_number }`)
    description: "..."       # optional, shown as help text next to the field
    required: true           # optional; required inputs gate the modal's submit
  - name: branch
    default: main            # optional, pre-fills the modal field

steps:                       # required, ≥1
  - use: <bundle-name>       # references scripts/<bundle-name>/run.sh
    name: "Fetch the PR"     # optional — short label shown as the step title in the Schema tab + run timeline
    description: "..."       # optional, longer detail surfaced when the step is expanded
    env:                     # optional, flat key→value map (value is string or `{ input: <name> }`)
      KEY: "value"
      PR_NUMBER:
        input: pr_number     # resolved at spawn from the run's `inputs` snapshot

  - sh: |                    # OR inline shell — sugar for one-shots
      set -eu
      echo "anything"
    name: "Post-process"     # optional — defaults to the script's first line when omitted
    description: "..."       # optional
    env:
      OTHER: "value"

publish:                     # optional, M6 — long-form markdown articles
  - name: digest             # required, kebab-case-only ([a-z0-9-]+), unique within workflow
    title: "Friendly Title"  # optional series label — feed chip + page eyebrow (defaults to a humanised name)
    description: "..."       # optional
    use: claude-code         # OR sh: |  …  — same shape as a step
    env:
      PROMPT_FILE: prompts/digest.tpl

summarize:                   # optional — one-shot post-run summary
  use: claude-code-summarizer
  env:                       # optional override (see bundle docs)
    MODEL: sonnet
```

### Top-level metadata (`description`, `group`)

Both optional, both pure presentation — neither affects execution.

- `description` — a one-line summary. Renders as the deck beneath the workflow's title on its page.
- `group` — a grouping label (e.g. `Dev`, `Ops`). Buckets the workflow under that label in the left-rail navigation: grouped workflows cluster beneath their label (groups sorted alphabetically), and any workflow without a `group` lists flat above the groups. It also shows as the eyebrow above the workflow's title on its page, so related workflows read as a set. Workflows sharing a `group` string land in the same cluster.

### Step shape rules

A step is **exactly one** of:

- `{ use: <bundle>, name?, description?, env? }` — resolves to `scripts/<bundle>/run.sh`. Missing bundle → workflow fails to load with a clear error.
- `{ sh: <string>, name?, description?, env? }` — inline shell, run via `sh -c`. Use YAML's `|` block scalar for multi-line.

`name?` and `description?` are both optional and both apply to either shape:

- `name` — a short, human-readable label, shown as the step's title in the Schema tab and the run timeline. Defaults to the bundle reference (`use:`) or the script's first non-empty line (`sh:`). Set it so multi-line scripts read as a label, not a code fragment.
- `description` — longer detail, surfaced when the step's row is expanded.

Mixing `use:` and `sh:` on the same step is a schema error.

### `env:` rules

- Flat `key → value` map. Each value is **either** a literal string **or** a structured `{ input: <name> }` reference to a declared workflow input.
- **String values must be strings.** Numbers/booleans must be quoted: `MAX_TURNS: "50"`, not `MAX_TURNS: 50`.
- `{ input: <name> }` refs point at the workflow's `inputs:` block — unknown names are caught at load time. The runner resolves each ref at spawn from the run's snapshotted `inputs`; refs to inputs that weren't supplied and have no default fail the spawn.
- Keys starting with `KIRI_` are **rejected at load time**. That namespace is reserved.
- User env is applied **first**, then `PATH`, `HOME`, `USER`, `LOGNAME` from the kiri parent process, then `KIRI_*` overlays. A workflow can't shadow `PATH` or `KIRI_RUN_ID`.

### `inputs:` rules

- Optional. Declares **named parameters collected via a modal** at invoke time. A workflow with no `inputs:` runs immediately on click, exactly as today; one with `inputs:` opens the modal first.
- Each entry is `{ name, description?, required?, default?, options? }`. **Values are strings** — env vars are strings anyway.
- `name` must match `^[a-z_][a-z0-9_]*$` and is unique within the workflow.
- `required: true` gates the modal's submit until the field is non-empty. `default` pre-fills the field at open.
- `options: [...]` constrains the input to a fixed list of allowed strings. The modal renders a picker (not a text field), the declared `default` (if any) must be one of the entries — failures are caught at load time — and values supplied at invoke are rejected if they aren't in the list. Useful for "pick one of these environments / models / regions" inputs.
- Wire an input into a step / publish / summarise `env:` with `{ input: <name> }`. No string interpolation, no templating — keep the YAML pure data.
- The resolved input map is snapshotted onto the run's row, so the feed shows what a run was invoked with and a future re-run can pre-fill from the same snapshot.

### `publish:` rules

- Each entry runs after `steps:` complete (on `ok` and `failed` runs, not `cancelled`). One after another, serially.
- Each entry's **trimmed stdout** is stored as a markdown article, keyed by `name`. It appears as a chip on the feed and a "Published" entry on the run detail page, with its own `/runs/:id/published/:name` view rendered through a sandboxed markdown parser.
- **Structure the body as a document with one headline and `##` sections.** Open with a single `# Headline` — the article page lifts it out as the page title and drops anything before it, so don't emit chatter like "Here's the article" ahead of it. Use `##` for the sections beneath: they become the article's table of contents. Sub-divide with `###` and deeper as usual.
- The publish `title` is the article's **series label**, shown as a feed chip and the page eyebrow — and used as the page title only when the body carries no `# Headline`. Let the body bring its own headline (this edition's subject) and let `title` name the recurring series (e.g. `Daily Briefing`).
- `name` must match `^[a-z0-9-]+$` and be unique within the workflow.
- A failing publish step does **not** fail the run — siblings still run. (Exception: cancel mid-publish flips the run to `cancelled` and halts further publishes.)

### `summarize:` rules

- Runs **after** publish entries, only on non-cancelled runs.
- Its trimmed stdout becomes the run's `summary` (rendered on the activity feed row and at the top of the run detail page).
- Failure is non-fatal — `runs.status` stays whatever `steps:` decided.
- Empty stdout leaves `summary` null.

### Recommendations — proposed follow-up workflows

A main step can recommend follow-up workflow invocations attached to its run. They surface on the run detail page under a **Recommended** section as trigger buttons; clicking one opens the standard invoke modal pre-filled with the proposed inputs. Use this when a run *enumerates* things a follow-up could act on — open PRs, failing tests, queued items — so each enumerated thing turns into a one-click launch.

- Write JSON Lines to the path in `$KIRI_RECOMMENDATIONS_FILE`, one object per line: `{ title, workflow, description?, inputs? }`. `title` and `workflow` are required; `inputs` is a flat `{ string: string }` map matching the target workflow's declared inputs.
- `KIRI_RECOMMENDATIONS_FILE` is set on **main `steps:` only** — not on `publish:` or `summarize:`. Don't read it from those phases.
- Only `ok` steps' files are ingested. A failed or cancelled step's recommendations are discarded.
- Malformed JSON or schema-failing lines are logged and skipped without affecting the step; surrounding valid lines still ingest.
- Cross-step ingestion order is preserved: a recommendation from step 0 always has a lower `index` than one from step 1.
- Don't try to look the target workflow up at emission time — the runner doesn't validate it. If the workflow disappears from your repo before the user clicks, the trigger button simply renders disabled with a "workflow not found" tooltip.

Example (a step that aggregates open PRs and recommends a per-PR review):

```yaml
name: open-prs
steps:
  - sh: |
      # gh pr list is scoped to a single repo, so resolve owner/name once.
      repo=$(gh repo view --json owner,name --jq '"\(.owner.login)/\(.name)"')
      gh pr list --json number,title,author | jq -c '.[]' | while read -r pr; do
        number=$(echo "$pr" | jq -r .number)
        title=$(echo "$pr" | jq -r .title)
        author=$(echo "$pr" | jq -r .author.login)
        jq -nc --arg n "$number" --arg t "$title" --arg a "$author" --arg r "$repo" \
          '{title: ("Review pull request " + $r + " #" + $n), description: ($t + " (by @" + $a + ")"), workflow: "pr-review", inputs: {pr_number: $n, repo: $r}}' \
          >> "$KIRI_RECOMMENDATIONS_FILE"
      done
```

Putting the action + `owner/repo` + PR number in the title and saving the PR's own title for the description keeps recommendations scannable across repos — without the repo qualifier a feed mixing runs against different repos would show indistinguishable "Review PR #5" entries.

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
| `KIRI_RECOMMENDATIONS_FILE` | Absolute path the step may write JSON Lines to, one recommendation per line: `{title, workflow, description?, inputs?}`. Lines are ingested as `recommendations` rows after the step succeeds; failed and cancelled steps' files are discarded. **Only set on main `steps:` — not `publish:` or `summarize:`.** |
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
  "articles": [
    { "name": "digest", "title": "...", "content_md": "..." }
  ]
}
```

`articles` is the **list of publish articles already produced when this step starts.** So:

- The first `publish:` entry sees `articles: []`.
- The Nth `publish:` entry sees articles 0..N-1.
- `summarize:` sees all articles.

The full per-step `stdout`/`stderr` is in there too — `publish:` and `summarize:` steps don't need to re-fetch the run.

### Reading the context: `KIRI_RUN_CONTEXT_FILE` vs `{{KIRI_RUN_CONTEXT}}`

Two ways to bring this JSON into a prompt, picked by what the model can do:

- **Agentic models that can open files** (e.g. Claude Code with the `Read` tool): reference `{{KIRI_RUN_CONTEXT_FILE}}` — the model opens the path itself. This is what `claude-code` / `claude-code-summarizer` do.
- **Non-agentic local models** (e.g. anything routed through `lm-studio-summarizer`): reference `{{KIRI_RUN_CONTEXT}}` — bundles in this class read the context file at the top of `run.sh` and expose its **content** as an env var, so the awk substitution pass splices the JSON directly into the prompt. Without this, a non-tool-using model leaks raw tool-call tokens into the response instead of reading the context.

`KIRI_RUN_CONTEXT` is a bundle-level convention, not a kiri-injected env var — only bundles that opt in (currently `lm-studio-summarizer`) expose it. If you author a bundle for a non-agentic runtime, expose the same placeholder by reading `KIRI_RUN_CONTEXT_FILE` into a `KIRI_RUN_CONTEXT` env var before the prompt-template substitution.

---

## Example bundles

Two bundles that show the common shape for an AI step — both spawn the Claude Code CLI, both use the same `{{VAR}}` templating, both are plain bash you can read and edit. They aren't created by `kiri init` (which scaffolds only a hello-world workflow); you author bundles yourself under `scripts/<name>/` — see *Authoring a custom bundle* below.

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
- Available vars: `KIRI_INPUT`, `KIRI_RUN_ID`, `KIRI_STEP_INDEX`, `KIRI_REPO_ROOT`, `KIRI_BUNDLE_DIR`, `KIRI_RUN_CONTEXT_FILE` (for `publish:`/`summarize:`), `KIRI_RECOMMENDATIONS_FILE` (for main steps only), plus anything in the step's own `env:` block.

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

# Do the thing; stdout goes to the next step / article / summary
printf 'processed %s for %s\n' "$TARGET" "$input"
```

**Rules:**

- Exit `0` on success; non-zero on failure. The exit code is what kiri reads.
- Don't `cd` away from the scratch dir unless you mean to — kiri restores nothing.
- Anything you read from disk should be resolved against `$KIRI_REPO_ROOT`, not relative cwd.
- Document the env-var contract in `README.md` next to `run.sh`.
- Adding a fork? `cp -r scripts/claude-code scripts/my-bundle && $EDITOR scripts/my-bundle/run.sh`.

---

## Invoking a workflow

- **Manual** — click *Run* in the UI on `https://local.kiri.build` (or `http://localhost:4242`). Workflows with `inputs:` open a modal first (one field per declared input, defaults pre-filled, required inputs gate submit); workflows without `inputs:` invoke on a single click.
- **Re-run** — an existing run can be re-triggered in place from its run detail page.

There is no cron, file watch, webhook, or inbox polling. For polling shapes, write a workflow whose first step does the poll and run it when you want it.

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

### 2. Shell → AI pipeline with a markdown article

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

The `publish:` step's prompt reads `KIRI_RUN_CONTEXT_FILE`, parses `steps[0].stdout` (the JSON array of HN items), and formats markdown. Stdout becomes the article.

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

### 4. Parameterised workflow with `inputs:`

```yaml
# workflows/pr-review.yaml
name: PR Review
group: Dev                   # clusters under "Dev" in the side nav
inputs:
  - name: pr_number
    description: GitHub PR to review (number, not URL)
    required: true
  - name: owner
    default: LeeCheneler
  - name: model
    description: Claude model to use for the review
    options: [haiku, sonnet, opus]
    default: sonnet
steps:
  - sh: gh pr view "$PR_NUMBER" --repo "$OWNER/kiri" --json title,body,files
    env:
      PR_NUMBER:
        input: pr_number
      OWNER:
        input: owner
  - use: claude-code
    env:
      PROMPT_FILE: prompts/pr-review.tpl
      MODEL:
        input: model
```

Clicking *Run* on this workflow opens a modal with three fields: `pr_number` (required text, blank), `owner` (text, pre-filled with the default), and `model` (picker constrained to `haiku | sonnet | opus`, pre-selected on `sonnet`). The runner snapshots the submitted values onto the run's row before spawning step 0, where the `{ input: <name> }` refs in `env:` resolve to the snapshotted values.

### 5. Multi-publish workflow

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

The `full` publish step's `articles` array in the context file already contains the `summary` article — useful if you want one publish to build on another.

### 6. Custom bundle with a typed env contract

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

## Charts in published articles

The markdown a `publish:` step emits can embed charts. Fence a block as
`chart` and put a [Vega-Lite](https://vega.github.io/vega-lite/) JSON spec
in the body; kiri renders it inline through the same sandboxed renderer as
the rest of the article. One spec format covers every chart type — bar,
line, area, scatter, arc (pie/donut), heatmap, and more.

````markdown
```chart
{
  "width": "container",
  "height": 200,
  "data": {
    "values": [
      { "day": "Mon", "runs": 12 },
      { "day": "Tue", "runs": 19 },
      { "day": "Wed", "runs": 8 }
    ]
  },
  "mark": "bar",
  "encoding": {
    "x": { "field": "day", "type": "nominal" },
    "y": { "field": "runs", "type": "quantitative" }
  }
}
```
````

- **Data is inline only.** Put the numbers in `data.values`. A spec that
  fetches remote data (`data: { url: ... }`) is rejected and degrades to a
  notice — a publish step should compute its data and write it into the
  spec.
- **Theming is automatic.** Background, fonts, axis/legend colours, and the
  palette come from the site theme. Don't hand-set `config` or colours
  unless an encoding genuinely needs a specific one.
- **`"width": "container"`** makes a chart fill the article column; pair it
  with an explicit `"height"`.
- **Bad specs degrade, they don't crash.** Invalid JSON, or a spec
  Vega-Lite rejects, renders an inline error notice; the surrounding
  article is unaffected.

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
| Using `dangerouslySetInnerHTML` in custom UI that renders articles | Don't. Articles render through a sandboxed markdown parser. AI/script output is untrusted. |
| A `chart` block whose spec fetches remote data (`data: { url }`) | Inline the data under `data.values`. Remote-data specs are rejected and degrade to a notice. |

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
