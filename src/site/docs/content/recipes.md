# Recipes

Complete workflows to copy and adapt. Each also ships runnable in the repo's
[`examples/`](https://github.com/LeeCheneler/kiri/tree/main/examples)
directory — itself a kiri workspace: point kiri at it and run. The `llm:`
recipes need a provider in `kiri.yaml` (see
[Models & providers](/docs/llm-providers)); the rest need no key at all.

## Release notes from your git log

One `llm:` step drafts from the log, a second writes the article, and a
short summariser prompt captions the run — no bundle, no glue scripts:

```yaml
# workflows/release-notes.yaml
name: Release Notes
steps:
  - sh: git log --oneline v1.4.0..HEAD
    id: changes
    name: Collect changes
  - llm:
      model: anthropic:claude-haiku-4-5
      prompt: |
        Rewrite these changelog lines as friendly release notes,
        grouped under Features and Fixes.

        {{CHANGES}}
    id: draft
    name: Draft the notes
    env:
      CHANGES: { step: changes }
articles:
  - slug: release-notes
    name: Release Notes
    llm:
      model: anthropic:claude-haiku-4-5
      prompt_file: prompts/release-notes.tpl   # reads {{DRAFT}}
    env:
      DRAFT: { step: draft }
summarize:
  llm:
    model: anthropic:claude-haiku-4-5
    prompt: "One feed sentence: what shipped in these notes? {{NOTES}}"
  env:
    NOTES: { article: release-notes }
```

## One-click PR reviews

Two workflows working together. **Review Queue** finds every open PR waiting
on you and emits one recommendation per match — each a one-click button on the
run page. **PR Review** is the workflow those buttons invoke, its `repo` and
`pr_number` inputs pre-filled.

The queue aggregates with `gh`, then emits one recommendation per PR with
`kiri-recommend`:

```yaml
# workflows/review-queue.yaml (excerpt — full version in examples/)
name: Review Queue
steps:
  - sh: |
      set -eu
      gh search prs --review-requested=@me --state=open \
        --json number,title,repository,author --limit 100 |
      jq -c '.[]' | while read -r pr; do
        repo=$(echo "$pr" | jq -r .repository.nameWithOwner)
        number=$(echo "$pr" | jq -r .number)
        kiri-recommend \
          --workflow "PR Review" \
          --title "Review pull request ${repo} #${number}" \
          --description "$(echo "$pr" | jq -r .title) (by @$(echo "$pr" | jq -r .author.login))" \
          --input "repo=${repo}" --input "pr_number=${number}"
      done
    name: Aggregate open PRs
```

The review itself fetches the PR and hands it to a model to write up:

```yaml
# workflows/pr-review.yaml
name: PR Review
inputs:
  - name: repo
    description: GitHub repo as owner/name
    required: true
  - name: pr_number
    description: PR number to review
    required: true
steps:
  - sh: |
      set -eu
      gh pr view "$PR_NUMBER" --repo "$REPO" \
        --json number,title,body,additions,deletions,files,author,url
    id: fetch
    name: Fetch the PR
    env:
      REPO: { input: repo }
      PR_NUMBER: { input: pr_number }
articles:
  - slug: review
    name: PR Review
    use: claude-code
    env:
      PROMPT_FILE: prompts/pr-review.tpl   # reads {{PR}}
      MODEL: haiku
      PR: { step: fetch }
```

## A daily briefing

Fetch the sources you care about, let a model write the morning's brief. The
example version pulls Hacker News and Dev.to with `curl`, then writes the
article through the `claude-code` bundle:

```yaml
# workflows/daily-briefing.yaml (shape — full version in examples/)
name: Daily Briefing
steps:
  - sh: |
      set -eu
      curl -fsSL "https://hacker-news.firebaseio.com/v0/beststories.json"
      # ...fetch each story and any other sources, emit one JSON blob...
    id: fetch
    name: Fetch news sources
articles:
  - slug: briefing
    name: Daily Briefing
    use: claude-code
    env:
      PROMPT_FILE: prompts/daily-briefing.tpl   # reads {{NEWS}}
      MODEL: haiku
      NEWS: { step: fetch }
summarize:
  llm:
    model: anthropic:claude-haiku-4-5
```

Swap the fetch step for your own sources — RSS, your issue tracker, an
internal API — and the shape holds.

## Spawn Claude Code from a step

The `claude-code` bundle used above turns the Claude Code CLI into a workflow
step: it renders a prompt (inline or from a template file), runs the agent,
and puts its final output on stdout. Copy it from
[`examples/bundles/claude-code`](https://github.com/LeeCheneler/kiri/tree/main/examples/bundles/claude-code)
into your own `bundles/` and call it anywhere an agent should do the work:

```yaml
steps:
  - use: claude-code
    env:
      PROMPT: "Summarise {{DATA}} in one sentence."
      DATA: { step: fetch }
      MODEL: haiku          # optional
      MAX_TURNS: "50"       # optional
```

Its `README.md` documents the full env contract — the pattern works for any
agentic CLI you can script.

## Charts in an article

Any article can render data inline: fence a block as ` ```chart ` with a
[Vega-Lite](https://vega.github.io/vega-lite/) spec, or as ` ```mermaid ` for
a diagram. An `sh:` article that emits this produces a live bar chart:

````yaml
articles:
  - slug: weekly-runs
    sh: |
      echo "# Runs this week"
      echo
      echo '```chart'
      echo '{
        "width": "container", "height": 200, "mark": "bar",
        "data": { "values": [
          { "day": "Mon", "runs": 12 }, { "day": "Tue", "runs": 19 },
          { "day": "Wed", "runs": 8 } ] },
        "encoding": {
          "x": { "field": "day", "type": "nominal" },
          "y": { "field": "runs", "type": "quantitative" } }
      }'
      echo '```'
````

Models can emit these fences too — tell one to "include a chart block" in an
`llm:` prompt and the article arrives illustrated. The
[chart-gallery example](https://github.com/LeeCheneler/kiri/tree/main/examples)
exercises every chart type. Full rules in the
[workflow reference](/docs/workflow-reference).
