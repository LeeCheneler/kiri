# Examples

A complete, runnable kiri workspace kept as a reference. `kiri init`
scaffolds only a minimal hello-world workflow — these are the worked
examples it deliberately leaves out, so they stay discoverable without
being forced on every new repo.

## Layout

```
examples/
  llm-providers.yaml          # provider config for first-party llm: steps
  scripts/
    claude-code/              # spawn the Claude Code CLI with a rendered prompt
    claude-code-summarizer/   # summarise: step backed by Claude Code
    lm-studio/                # one-shot completion against an OpenAI-compatible local server
    lm-studio-summarizer/     # summarise: step backed by LM Studio
  workflows/
    daily-briefing.yaml       # composes a sh: fetch, a publish: article, and a summary
    review-queue.yaml         # cross-repo PR triage; recommends one PR Review per matching PR
    pr-review.yaml            # takes repo + pr_number inputs, fetches the PR, publishes a review
    chart-gallery.yaml        # publishes an article showcasing every embeddable chart type
    release-notes.yaml        # first-party llm: steps — completion, publish, and summary, no bundle
  prompts/
    daily-briefing.tpl        # prompt template for the briefing
    pr-review.tpl             # prompt template for the PR review
    release-notes.tpl         # prompt template for the llm: release-notes article
```

Each bundle's `README.md` documents its env-var contract — the
load-bearing reference for authoring your own bundles.

## Using a bundle

Bundles are plain bash. Copy the one you want into your own workspace's
`scripts/` directory and reference it from a workflow's `use:` field:

```sh
cp -r examples/scripts/claude-code path/to/your/workspace/scripts/
```

## First-party `llm:` steps — the release-notes example

For a plain completion — send a prompt, get text back — you don't need a
bundle at all. An `llm:` step calls a model provider directly:

```yaml
- llm:
    model: anthropic:claude-haiku-4-5
    prompt: |
      Summarise the following in three bullets.

      {{KIRI_INPUT}}
```

`release-notes.yaml` shows the full shape — an `llm:` step in the pipeline,
an `llm:` publish that writes the article, and a zero-config `llm:`
summariser (`summarize: { llm: { model } }`, which uses a built-in prompt):

- **Providers live in `llm-providers.yaml`.** Each `model:` is a
  `provider:model` id whose prefix names an entry there. API keys are
  always `{ env: <NAME> }` references — a literal key is rejected so
  secrets stay out of git. Point the example at `local:<model>` (the
  bundled `openai-compatible` entry) to run against LM Studio / Ollama
  with no key.
- **Templating matches the bundles.** `{{KIRI_INPUT}}` carries the
  previous step's stdout into an `llm:` step's prompt. Publish and
  summarise steps receive the run envelope inlined as
  `{{KIRI_RUN_CONTEXT}}` (each stream capped at 64 KB) rather than piped
  stdin.

Reach for a bundle (`claude-code`, `lm-studio`) when a step needs to *do*
something — spawn a CLI, shell out, run an agent. Reach for `llm:` when it
just needs a completion. Running it needs `ANTHROPIC_API_KEY` in the
environment (or a `local:` model and a server on `base_url`).

## Running the examples

This directory is itself a kiri workspace. From the repo root:

```sh
cd examples
kiri
```

The kiri project runs `daily-briefing.yaml` as its own dogfood and smoke
test — see `CONTRIBUTING.md`.

## Recommendations — the review-queue / pr-review pair

`review-queue.yaml` demonstrates the **recommendations channel**: a
main step writes one JSON Lines record per follow-up workflow it
wants to propose to the path in `$KIRI_RECOMMENDATIONS_FILE`. Kiri
ingests those after the step succeeds and surfaces them on the
producing run's detail page under a "Recommended" section. Each
recommendation is a trigger button that opens the standard invoke
modal pre-filled with the proposed `workflow` and `inputs`.

The pair is composed deliberately:

- `review-queue` aggregates every open PR awaiting your attention
  across all repos you have access to. It merges three signals via
  `gh search prs` — PRs requesting your review directly, PRs
  requesting review from any team you're a member of, and PRs where
  you're the assignee — dedupes them, and emits one
  `{ title, description, workflow: "PR Review", inputs: { pr_number, repo } }`
  record per PR.
- `pr-review` is the target — declares required `repo` and
  `pr_number` inputs, fetches the PR via `gh pr view --repo`, and
  publishes a markdown review via `claude-code`.

Together they show the common shape: an aggregator workflow that
*enumerates* things, turning each into a one-click follow-up launch.
Requires `gh` (signed in) and `claude` on `PATH`.
