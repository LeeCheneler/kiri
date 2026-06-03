# Examples

A complete, runnable kiri workspace kept as a reference. `kiri init`
scaffolds only a minimal hello-world workflow — these are the worked
examples it deliberately leaves out, so they stay discoverable without
being forced on every new repo.

## Layout

```
examples/
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
  prompts/
    daily-briefing.tpl        # prompt template for the briefing
    pr-review.tpl             # prompt template for the PR review
```

Each bundle's `README.md` documents its env-var contract — the
load-bearing reference for authoring your own bundles.

## Using a bundle

Bundles are plain bash. Copy the one you want into your own workspace's
`scripts/` directory and reference it from a workflow's `use:` field:

```sh
cp -r examples/scripts/claude-code path/to/your/workspace/scripts/
```

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
