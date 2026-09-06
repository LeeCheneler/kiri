# Kiri

> An AI workspace that runs on your machine and writes things down — sessions become readable pages, facts become memories, and repeated chores become one-click buttons.

<a href="https://kiri.build"><img src="https://kiri.build/screenshots/session.png" alt="A kiri session inside a project: the assistant has written the discussion up as an article in the project corpus and saved a memory, with the project's articles listed in the sidebar" width="100%"></a>

Every AI tool you use forgets. Chats scroll away, context gets re-explained, and the same chore gets re-prompted every week. Kiri is a **local-first AI workspace** built so work compounds instead:

1. **Work it out in a session.** A general-purpose agentic assistant with any model you configure — for a conversation, a piece of research, a review, a write-up, or a code change. It reads and edits your files, runs your shell, delegates legwork to a worker, and reaches any MCP server; every tool's permission is yours to set: allow, ask, or off.
2. **Keep what matters.** Output lands as **articles**: readable pages in a live feed, with charts and diagrams, not scrollback. Facts persist as memories; related work compounds into a project's shared, cross-linked corpus.
3. **Automate the repeats.** Anything worth doing twice hardens into a **workflow** — a YAML file in your repo, runnable as a one-click button. A session can author it for you.

Bring your own model — Anthropic, OpenAI, Codex with a ChatGPT subscription, or any OpenAI-compatible endpoint (OpenRouter, LM Studio, Ollama, vLLM). Nothing leaves your machine except the model calls you configure, and kiri only runs while the app is open.

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

**📖 Full documentation → [kiri.build/docs](https://kiri.build/docs)**

## Highlights

- **Sessions do whatever the work is.** Think something through, research a question, review a PR, draft a doc, fix a bug — one surface. Sessions find, read, and edit files; run builds, tests, and git; search the web and your tools through MCP; generate images inline; and delegate legwork to a hidden worker that reports back only its findings — with any model, streaming.
- **On a leash you hold.** Sessions are confined to directories you allow. Every write shows as a diff and asks first; shell approvals can go **Auto**, where a hard deterministic screen always stops the dangerous stuff and a small judge model waves through the boring stuff. Delegated workers never hold a tool you haven't already set to always-allow.
- **Everything is written down.** Sessions and runs alike produce articles — markdown with inline charts and diagrams — collected in one live feed with a view for just the writing.
- **Memories and projects.** Sessions save durable facts every future session recalls. Group work into a project and its sessions share an article corpus with `[[wiki-links]]`, their own memories, and standing instructions.
- **Standing instructions and skills.** Layer instructions from `kiri.md`, a project, and `AGENTS.md` files; load workspace skills on demand.
- **Chat graduates into automation.** Work something out in a session, then have it author the workflow — validated YAML written into your repo, ready as the next button.
- **Workflows are buttons.** Shell steps feeding model steps through declared refs; rerun forever with one click, and runs can recommend one-click follow-ups.
- **Search everything.** ⌘K from anywhere, across articles, transcripts, run summaries, and workflow names — results as you type.

The [sessions docs](https://kiri.build/docs/sessions) cover the lot.

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

Kiri runs per-directory — each working directory is its own workspace.

```sh
cd ~/projects/some-workspace
kiri init    # scaffold a starter workflow and config
kiri         # boot on :4242
```

Then open **[local.kiri.build](https://local.kiri.build)** — the hosted shell loads kiri's UI from your locally-running process. To pin a workspace regardless of where you launch from, set `KIRI_CONFIG_DIR` (a leading `~` is expanded).

> **Safari / Brave:** both block HTTP-localhost requests from an HTTPS page, so use **http://localhost:4242** directly there. Chrome and Firefox work either way.

From here, the [quickstart](https://kiri.build/docs/getting-started) takes you from install to your first model-written article in about five minutes, and the [recipes](https://kiri.build/docs/recipes) are complete workflows to copy.

One thing to know before you run other people's workflows: `sh:` steps and bundle scripts run with **your user's permissions**, like any shell script — read them first. [Trust & security](https://kiri.build/docs/trust-and-security) has the full picture.

## Learn more

- **[kiri.build/docs](https://kiri.build/docs)** — full documentation: workflows, recipes, sessions, providers, the CLI.
- [`examples/`](./examples/) — a complete, runnable example workspace.
- [`docs/design-notes.md`](./docs/design-notes.md) — architecture and design invariants.
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — repo setup and dev workflow.
