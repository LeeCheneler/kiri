# Writing workflows

A workflow is a YAML file in `workflows/` — a named sequence of steps kiri
runs on demand. This guide walks the golden path: run commands,
hand their output to a model, publish an article. Every field in full lives
in the [workflow reference](/docs/workflow-reference).

## Start with a shell step

The smallest workflow is a name and one `sh:` step:

```yaml
name: Open PRs
steps:
  - sh: |
      set -eu
      cd "$KIRI_REPO_ROOT"
      gh pr list --state open
```

Two habits worth forming from the first step: start non-trivial scripts with
`set -eu` (`sh -c` doesn't stop on the first failure by default), and reach
repo files via `$KIRI_REPO_ROOT` — steps run in a per-run scratch directory,
not your repo.

## Wire steps together

A step passes data forward by declaring an `id:`; any later phase pulls its
stdout in with a `{ step: <id> }` env ref — the value arrives as an ordinary
env var under the name you chose:

```yaml
name: Greet
steps:
  - sh: printf "Lee"
    id: who
  - sh: 'echo "hello, $NAME"'
    env:
      NAME: { step: who }
```

Refs are checked when the file loads — a typo'd id is an error before
anything runs — and they reach *any* earlier step, not just the previous one.

## Add a model step

An `llm:` step sends a prompt to a model and puts the completion on stdout,
exactly like any other step. Refs render into the prompt as `{{VAR}}`
placeholders:

```yaml
name: Release Notes
steps:
  - sh: git log --oneline v1.4.0..HEAD
    id: commits
  - llm:
      model: anthropic:claude-haiku-4-5
      prompt: |
        Rewrite these commits as release notes,
        grouped under Features and Fixes.

        {{COMMITS}}
    env:
      COMMITS: { step: commits }
```

`model` is `provider:model` — the prefix names an entry in `kiri.yaml`. Wiring
one up takes four lines; see [Models & providers](/docs/llm-providers).

## Publish an article

Steps produce data; **articles** write it up. An `articles:` entry runs after
the steps and its stdout becomes a rendered markdown page — in the feed, with
its own URL. Wire its data in the same way as any step — a `{ step: <id> }`
env ref to the producer:

```yaml
name: Release Notes
steps:
  - sh: git log --oneline v1.4.0..HEAD
    id: commits
  - llm:
      model: anthropic:claude-haiku-4-5
      prompt: |
        Rewrite these commits as release notes.

        {{COMMITS}}
    id: draft
    env:
      COMMITS: { step: commits }
articles:
  - slug: release-notes
    name: Release Notes
    sh: 'printf "%s" "$DRAFT"'
    env:
      DRAFT: { step: draft }
```

Open the article body with a single `# Headline` — it becomes the page title.
Articles can embed live charts and diagrams with fenced ` ```chart ` and
` ```mermaid ` blocks; see the [recipes](/docs/recipes) for both in action.

## Summarise the run

`summarize:` gives the run a one-line summary for the feed. Like every phase
it declares its data with refs — hand it the finished article, or a named
output, and ask for the feed line directly:

```yaml
summarize:
  llm:
    model: anthropic:claude-haiku-4-5
    prompt: "One sentence for an activity feed: {{NOTES}}"
  env:
    NOTES: { article: release-notes }
```

## Take inputs

`inputs:` parameterises a workflow. Declaring any means a run collects the
values first; wire them into steps with `{ input: <name> }`:

```yaml
name: PR Review
inputs:
  - name: pr_number
    description: GitHub PR to review
    required: true
steps:
  - sh: gh pr view "$PR_NUMBER" --json title,body,files
    env:
      PR_NUMBER: { input: pr_number }
```

One `PR Review` workflow now reviews any PR, instead of one file per PR.

## Name your outputs

When a step computes more than one value, whole-stdout refs force every
consumer to re-parse the same blob. Declare `outputs:` instead and emit each
value with `kiri-output`, which kiri puts on the step's `PATH`; later phases
pull exactly the value they need with `{ step: <id>, output: <name> }`:

```yaml
steps:
  - sh: |
      set -eu
      pr_count=$(gh pr list --state open --json number | jq length)
      kiri-output count "$pr_count"
      kiri-output repo "$(gh repo view --json nameWithOwner -q .nameWithOwner)"
    id: scan
    outputs: [count, repo]
  - sh: 'echo "$COUNT open PRs in $REPO"'
    env:
      COUNT: { step: scan, output: count }
      REPO: { step: scan, output: repo }
```

The declaration is a contract: a step that exits ok without emitting every
declared name fails, so a consumer's ref can never come up empty. Stdout
stays what it always was — the step's log — and the emitted values show up
on the run page under the step's row.

## Recommend follow-ups

A step can propose next runs with `kiri-recommend` — on the step's `PATH`,
like `kiri-output` — each call a workflow to invoke with pre-filled inputs:

```sh
kiri-recommend --workflow "PR Review" --title "Review kiri #42" --input pr_number=42
```

They surface as one-click follow-ups on the run. An aggregator that finds
five open PRs can attach a review to each — see the
[one-click PR reviews recipe](/docs/recipes) for the full pattern, and the
[reference](/docs/workflow-reference) for every flag.

## Grow a step into a bundle

When an inline script outgrows `sh:`, move it to `bundles/<name>/run.sh` and
call it with `use:`. Bundles are reusable, version-controlled, and take their
parameters as env vars:

```yaml
steps:
  - use: claude-code
    env:
      PROMPT: "Summarise {{DATA}} in one sentence."
      DATA: { step: fetch }
```

That `claude-code` bundle — a step that spawns the Claude Code CLI — ships in
the repo's [examples](/docs/recipes), ready to copy. The
[reference](/docs/workflow-reference) covers authoring your own.

You don't have to write every workflow by hand, either: a session can author
one for you — work the steps out in chat, then ask it to save the result as
a workflow. See [Sessions → Authoring workflows](/docs/sessions).

## Next

- [Recipes](/docs/recipes) — complete workflows to copy and adapt.
- [Workflow reference](/docs/workflow-reference) — every field, table by table.
- [Models & providers](/docs/llm-providers) — the provider registry.
