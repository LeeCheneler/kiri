# Kiri

> An AI workspace for work worth keeping.

Research, write, and code with an assistant on your machine. Keep useful answers as pages, carry context between sessions, and turn repeat tasks into workflows.

<a href="https://kiri.build"><img src="https://kiri.build/screenshots/session.png" alt="A kiri session inside a project: the assistant has written the discussion up as an article in the project corpus and saved a memory, with the project's articles listed in the sidebar" width="100%"></a>

Kiri is a **local-first AI workspace** for everyday work and the knowledge you want to keep:

1. **Work it out in a session.** A general-purpose agentic assistant with any model you configure — for a conversation, a piece of research, a review, a write-up, or a code change. It reads and edits your files, runs your shell, delegates legwork to a worker, and reaches any MCP server; every tool's permission is yours to set: allow, ask, or off.
2. **Keep what matters.** Substantial write-ups and reusable conclusions can become **articles**: readable pages in a live feed, with charts and diagrams. Facts persist as memories; related work compounds into a project's shared, cross-linked corpus.
3. **Automate when you choose.** If you want a repeatable task as a button, ask a session to create a **workflow** — a YAML file in your repo. Most work can stay in general-purpose and coding sessions.

Bring your own model — Anthropic, OpenAI, Codex with a ChatGPT subscription, or any OpenAI-compatible endpoint (OpenRouter, LM Studio, Ollama, vLLM). Your saved work lives on your disk. Cloud models and connected tools receive the data needed for their calls. Kiri runs while the app is open.

For subscription access, [configure `openai-codex`](https://kiri.build/docs/llm-providers#codex-with-a-chatgpt-subscription) after signing in through the Codex CLI.

The whole configuration is one file. Every section is optional; this one names two providers, tells sessions which directories they may work in, and adds a tool:

```yaml
# kiri.yaml
providers:
  anthropic:
    type: anthropic
    api_key: { env: ANTHROPIC_API_KEY }   # keys are always env refs, never literals
  openrouter:
    type: openai-compatible
    base_url: https://openrouter.ai/api/v1
    api_key: { env: OPENROUTER_API_KEY }
models:
  shortcuts:
    text:
      flash: openrouter:google/gemini-3.7-flash   # picker shortcut; sessions take any provider:model
filesystem:
  allowed_directories: [.]                        # where sessions may read, edit, and run commands
mcp:
  tavily:
    type: http
    url: https://mcp.tavily.com/mcp/
    auth: oauth
```

A workflow is one more small file — shell steps piped into model steps, run from a button:

```yaml
# workflows/release-notes.yaml
name: Release Notes
steps:
  - sh: git -C "$KIRI_REPO_ROOT" log --oneline -20
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

**📖 Full documentation → [kiri.build/docs](https://kiri.build/docs)**

For repository work, read [AGENTS.md](AGENTS.md). To set up instructions in a
workflow workspace, copy [EXAMPLE_AGENTS.md](EXAMPLE_AGENTS.md) as `AGENTS.md`
along with [docs/workflow-authoring.md](docs/workflow-authoring.md). For Claude
Code, add a `CLAUDE.md` containing `@./AGENTS.md`.

## Highlights

- **Sessions do whatever the work is.** Think something through, research a question, review a PR, draft a doc, fix a bug — one surface. Sessions find, read, and edit files; run builds, tests, and git; search the web and your tools through MCP; generate images inline; and delegate substantial independent work to a worker that reports findings with evidence — with any model, streaming.
- **On a leash you hold.** Sessions are confined to directories you allow. Every write shows as a diff and asks first; shell approvals can go **Auto**, where a hard deterministic screen always stops the dangerous stuff and a small judge model waves through the boring stuff. Delegated workers use the same permission gates; they cannot approve their own calls.
- **Useful writing stays useful.** Sessions and runs can produce articles — markdown with inline charts and diagrams — collected in one live feed. Quick answers and routine code changes need no extra document.
- **Memories and projects.** Sessions save durable facts every future session recalls. Group work into a project and its sessions share an article corpus with `[[wiki-links]]`, their own memories, and standing instructions.
- **Reuse prior work.** Ask what you concluded in an earlier session. The assistant can search saved knowledge, open relevant excerpts, and link its sources. Project sessions search their project by default, with explicit workspace-wide retrieval when needed.
- **Standing instructions and skills.** Layer instructions from `kiri.md`, a project, and `AGENTS.md` files; load workspace skills on demand.
- **Automation on request.** Ask a session to turn a repeatable task into a workflow — validated YAML written into your repo. It creates one only when you explicitly ask.
- **Workflows are buttons.** Shell steps feeding model steps through declared refs; rerun forever with one click, and runs can recommend one-click follow-ups.
- **Search everything.** ⌘K from anywhere, across articles, transcripts, run summaries, and workflow names — results as you type.

Start with the [session guide](https://kiri.build/docs/sessions); the [session reference](https://kiri.build/docs/session-reference) covers tools, permissions, and limits.

## Install

macOS on Apple silicon (ARM64) — [open an issue](https://github.com/LeeCheneler/kiri/issues) if you'd like another platform.

```sh
brew install LeeCheneler/kiri/kiri
kiri --version
```

Homebrew auto-taps [`LeeCheneler/homebrew-kiri`](https://github.com/LeeCheneler/homebrew-kiri) on first install; upgrade later with `brew upgrade kiri`.

<details>
<summary>Without Homebrew</summary>

Download the macOS ARM64 binary from the [latest release](https://github.com/LeeCheneler/kiri/releases/latest), make it executable, clear the macOS quarantine flag, and put it on your `$PATH`:

```sh
chmod +x ~/Downloads/kiri
xattr -d com.apple.quarantine ~/Downloads/kiri
sudo mv ~/Downloads/kiri /usr/local/bin/kiri
kiri --version
```

</details>

## Quickstart

Follow the [quickstart](https://kiri.build/docs/getting-started) to initialise a
workspace, connect a model, and start your first conversation. Configure your
provider before launching Kiri; workspace `.env` files load at startup.

Kiri runs per folder. Open [local.kiri.build](https://local.kiri.build) once
Kiri is running, or use **http://localhost:4242** directly if your browser
cannot connect. Keep the terminal running while you use it.

- [Work with files](https://kiri.build/docs/working-with-files) — enable access to your notes or code.
- [Projects & memories](https://kiri.build/docs/projects-and-memories) — keep related work together.
- [Create a workflow](https://kiri.build/docs/workflows) — save a task to run again.

Workflow scripts run with your user's permissions. Review workflows before
running them; [Trust & security](https://kiri.build/docs/trust-and-security)
explains the boundaries.

## Learn more

- **[kiri.build/docs](https://kiri.build/docs)** — full documentation: workflows, recipes, sessions, providers, the CLI.
- [`examples/`](./examples/) — a complete, runnable example workspace.
- [`docs/design-notes.md`](./docs/design-notes.md) — architecture and design invariants.
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — repo setup and dev workflow.
