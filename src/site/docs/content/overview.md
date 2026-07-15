# What is kiri?

Kiri turns repetitive AI chores into one-click buttons. You describe a chore —
release notes from your git log, a PR review, a morning briefing — as a small
YAML file in your repo. Kiri runs it on your machine and writes the result up
as an **article**: a readable page in a live feed, not scrollback in a terminal.

```yaml
# workflows/release-notes.yaml
name: Release Notes
steps:
  - sh: git log --oneline v1.4.0..HEAD
  - llm:
      model: anthropic:claude-haiku-4-5
      prompt: |
        Rewrite these commits as release notes,
        grouped under Features and Fixes.

        {{KIRI_INPUT}}
    id: draft
articles:
  - slug: release-notes
    sh: 'printf "%s" "$DRAFT"'
    env:
      DRAFT: { step: draft }
```

Click **Run** and kiri pipes each step into the next — shell commands and model
calls alike — then renders the output as an article in your feed.

## Two ways to work

- **Workflows** — scripted chores like the one above. Reach for a workflow when
  you know the shape of the work.
- **Sessions** — chat with the same models, plus tools from MCP servers you
  configure. Sessions write articles too, on request, and can run your
  workflows for you. Reach for a session when you don't.

Both land in the same activity feed — and everything they produce is
searchable: press `⌘K` (or click the search box above the feed) and results
appear as you type, across articles, session transcripts, run summaries, and
your workflows.

## Why kiri

- **A report, not a log.** Runs produce articles — markdown with inline charts
  and diagrams — plus a one-line summary on the feed. A run can even recommend
  one-click follow-ups.
- **Files in your repo.** Every workflow, persona, and config value is a file
  you can diff, commit, and review. Edits apply live, no restart.
- **Your machine, your keys.** Bring Anthropic, OpenAI, or any OpenAI-compatible
  server (LM Studio, Ollama, vLLM). Steps run as you, against your real tools.
- **Nothing in the background.** No cloud, no daemons, no cron. Kiri does its
  work only while you have it open.

## Where next

- [Quickstart](/docs/getting-started) — installed and reading your first
  article in five minutes.
- [Recipes](/docs/recipes) — release notes, one-click PR reviews, a daily
  briefing.
- [Writing workflows](/docs/workflows) — the golden path, step by step.
- [Sessions](/docs/sessions) — chat, personas, MCP tools, running and
  authoring workflows, and articles.
