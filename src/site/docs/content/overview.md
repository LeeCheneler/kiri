# What is kiri?

Kiri is an AI workspace that runs on your machine and writes things down —
chats become readable pages, facts become memories, and repeated chores become
one-click buttons.

Most AI tools forget: chats scroll away, context gets re-explained, the same
chore gets re-prompted every week. Kiri is built so work compounds instead,
and its shape is a ladder:

1. **Work it out in chat.** A **session** is streaming chat with your own
   models, wired into your files and shell and extended by any MCP server you
   configure — every risky action waiting on your approval.
2. **Keep what matters.** Output lands as **articles** — readable pages in a
   live feed, with charts and diagrams — not scrollback. Facts persist as
   curatable **memories**, and related work groups into a **project**: a
   shared, cross-linked corpus with its own memories and standing
   instructions.
3. **Automate the repeats.** Anything worth doing twice hardens into a
   **workflow** — a small YAML file in your repo, runnable as a one-click
   button, and a session can author it for you.

A workflow at the top of that ladder looks like this:

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

Sessions and runs land in the same activity feed, filterable to just runs,
just sessions, or just the **articles** they wrote — the last of these being
where a project's shared corpus shows up, since those articles belong to the
project rather than to any one session. Everything they produce is searchable
— articles, session titles and transcripts, run summaries, and the workflows
themselves.

## Why kiri

- **Written down, not scrolled past.** Sessions and runs produce articles —
  markdown with inline charts and diagrams — plus a one-line summary on the
  feed. A run can even recommend one-click follow-ups.
- **Files in your repo.** Every workflow, prompt, and config value is a file
  you can diff, commit, and review. Edits apply live, no restart.
- **Your machine, your keys.** Bring Anthropic, OpenAI, or any OpenAI-compatible
  server (LM Studio, Ollama, vLLM). Steps run as you, against your real tools.
- **Nothing in the background.** No cloud, no daemons, no cron. Kiri does its
  work only while you have it open.

## Where next

- [Quickstart](/docs/getting-started) — installed and reading your first
  article in five minutes.
- [Sessions](/docs/sessions) — chat, standing instructions, MCP tools, running
  and authoring workflows, and articles.
- [Writing workflows](/docs/workflows) — the golden path, step by step.
- [Recipes](/docs/recipes) — release notes, one-click PR reviews, a daily
  briefing.
