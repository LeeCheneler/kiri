# Examples

The kiri repo ships a complete, runnable workspace at
[`examples/`](https://github.com/LeeCheneler/kiri/tree/main/examples) — the
worked examples `kiri init` deliberately leaves out, so they stay discoverable
without being forced on every new repo. It's itself a kiri workspace: point kiri
at it and run.

## Layout

```
examples/
  kiri.yaml                   # providers for first-party llm: steps
  bundles/
    claude-code/              # spawn the Claude Code CLI with a rendered prompt
    claude-code-summarizer/   # summarize: step backed by Claude Code
    lm-studio/                # one-shot completion against a local OpenAI-compatible server
    lm-studio-summarizer/     # summarize: step backed by LM Studio
  workflows/
    daily-briefing.yaml       # sh: fetch → publish: article → summary
    review-queue.yaml         # cross-repo PR triage; recommends one PR Review per match
    pr-review.yaml            # repo + pr_number inputs; fetches the PR and publishes a review
    chart-gallery.yaml        # an article showcasing every embeddable chart type
    release-notes.yaml        # first-party llm: steps — completion, publish, summary
  prompts/                    # prompt templates for the above
```

Each bundle's `README.md` documents its env-var contract — the load-bearing
reference for authoring [your own bundles](/docs/workflows).

## Bundled workflows

- **daily-briefing** — composes a `sh:` fetch, a `publish:` article, and a
  summary. A good template for "fetch something, write it up."
- **review-queue** — aggregates open PRs across repos and emits one
  [recommendation](/docs/workflows) per match, each a one-click PR Review.
- **pr-review** — takes `owner` and `pr_number` [inputs](/docs/workflows),
  fetches the PR, and publishes a review.
- **chart-gallery** — publishes an article exercising every embeddable
  [chart type](/docs/workflows).
- **release-notes** — first-party `llm:` steps end to end: a completion in the
  pipeline, an `llm:` publish, and a zero-config `llm:` summariser — no bundle.

## A first-party llm: pipeline

The `release-notes` example shows the full `llm:` shape — providers in
`kiri.yaml`, a pipeline completion reading `{{KIRI_INPUT}}`, an `llm:` publish
reading the inlined `{{KIRI_RUN_CONTEXT}}`, and a zero-config summariser:

```yaml
# kiri.yaml (workspace root)
providers:
  anthropic:
    type: anthropic
    api_key:
      env: ANTHROPIC_API_KEY
```

```yaml
# workflows/release-notes.yaml
name: Release Notes
steps:
  - sh: |
      cat <<'CHANGES'
      - add first-party llm: workflow steps
      - render llm token usage in the run timeline
      CHANGES
    name: Collect changes
  - llm:
      model: anthropic:claude-haiku-4-5
      prompt: |
        Rewrite these changelog lines as friendly release notes.

        {{KIRI_INPUT}}
    name: Draft the notes
publish:
  - slug: release-notes
    name: Release Notes
    llm:
      model: anthropic:claude-haiku-4-5
      prompt_file: prompts/release-notes.tpl   # reads {{KIRI_RUN_CONTEXT}}
summarize:
  llm:
    model: anthropic:claude-haiku-4-5          # zero-config — built-in prompt
```

## Copying an example

Bundles are plain bash — copy the one you want into your own workspace's
`bundles/` directory and reference it from a `use:` step:

```sh
cp -r examples/bundles/claude-code path/to/your/workspace/bundles/
```

Running the `llm:` examples needs a provider key (`ANTHROPIC_API_KEY` in your
environment or workspace `.env`) — or point a `model:` at a `local:`
OpenAI-compatible server with no key. See [LLM providers](/docs/llm-providers).
