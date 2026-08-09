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
    id: commits
  - llm:
      model: anthropic:claude-haiku-4-5
      prompt: |
        Rewrite these commits as release notes,
        grouped under Features and Fixes.

        {{COMMITS}}
    id: draft
    env:
      COMMITS: { step: commits }
articles:
  - slug: release-notes
    sh: 'printf "%s" "$DRAFT"'
    env:
      DRAFT: { step: draft }
```

Click **Run** and kiri walks the steps in order — shell commands and model
calls alike, each declaring the data it needs — then renders the output as an
article in your feed.

## Two ways to work

- **Workflows** — scripted chores like the one above. Reach for a workflow when
  you know the shape of the work.
- **Sessions** — chat with the same models, plus tools from MCP servers you
  configure. Sessions write articles too, on request, can run your
  workflows for you, can delegate research to a separate worker session
  that reports back just the findings, and remember durable facts across
  sessions as curatable memories. Group related sessions into a **project**
  and they share one corpus of articles — read, kept current, and
  cross-linked by every session in it. Reach for a session when you don't.

Both land in the same activity feed, filterable to just runs, just sessions,
or just the **articles** they wrote — the last of these being where a
project's shared corpus shows up, since those articles belong to the project
rather than to any one session. Everything they produce is searchable —
articles, session titles and transcripts, run summaries, and the workflows
themselves.

## Why kiri

- **A report, not a log.** Runs produce articles — markdown with inline charts
  and diagrams — plus a one-line summary on the feed. A run can even recommend
  one-click follow-ups.
- **Files in your repo.** Every workflow, prompt, and config value is a file
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
- [Sessions](/docs/sessions) — chat, standing instructions, MCP tools, running and
  authoring workflows, and articles.
