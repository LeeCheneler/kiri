# What is kiri?

Kiri is an AI workspace that runs on your machine and writes things down —
sessions become readable pages, facts become memories, and repeated chores
become one-click buttons.

Most AI tools forget: chats scroll away, context gets re-explained, the same
chore gets re-prompted every week. Kiri is built so work compounds instead:

1. **Work it out in chat.** A **session** is streaming chat with any model
   you configure, wired into your files and shell and extended by any MCP
   server you add.
2. **Keep what matters.** Output lands as **articles** — readable pages in a
   live feed — facts persist as **memories**, and related work groups into a
   **project** with its own shared, cross-linked corpus.
3. **Automate the repeats.** Anything worth doing twice hardens into a
   **workflow** — a small YAML file in your repo, runnable as a one-click
   button. A session can author it for you.

## Two files and you're working

Configuration is a single `kiri.yaml` at the workspace root. The lightest
useful one names a model provider:

```yaml
# kiri.yaml
providers:
  anthropic:
    type: anthropic
    api_key: { env: ANTHROPIC_API_KEY }
```

Key in a git-ignored `.env`, and sessions work. A workflow is one more small
file:

```yaml
# workflows/release-notes.yaml
name: Release Notes
steps:
  - sh: git log --oneline v1.4.0..HEAD
    id: commits
  - llm:
      model: anthropic:claude-haiku-4-5
      prompt: |
        Rewrite these commits as release notes.

        {{COMMITS}}
    env:
      COMMITS: { step: commits }
```

Click **Run** and kiri walks the steps — shell and model alike — and the run
lands in your feed. Add an `articles:` entry and the output renders as a
page of its own: see [Writing workflows](/docs/workflows).

## The feature set

- **[Agentic sessions](/docs/sessions)** — chat wired into your files and
  shell, with per-tool permissions you set: allow, ask, or off.
- **[Local workflows](/docs/workflows)** — repeated chores as YAML in your
  repo, runnable as a button.
- **[Projects](/docs/projects-and-memories)** — a home for one body of work:
  its sessions, articles, and memories, cross-linked into a corpus.
- **[MCP servers](/docs/sessions)** — extend sessions with any MCP server's
  tools.
- **[Any model](/docs/llm-providers)** — Anthropic, OpenAI, or any
  OpenAI-compatible server: LM Studio, Ollama, vLLM.
- **Local & open source** — one binary bound to `127.0.0.1`, everything
  stored in SQLite on your disk, every line on
  [GitHub](https://github.com/LeeCheneler/kiri).

## Where next

- [Quickstart](/docs/getting-started) — installed and reading your first
  article in five minutes.
- [Sessions](/docs/sessions) — instructions, tools, files and shell,
  articles.
- [Projects & memories](/docs/projects-and-memories) — where work compounds.
- [Writing workflows](/docs/workflows) — the golden path, step by step.
- [Recipes](/docs/recipes) — complete workflows to copy and adapt.
