# Kiri

> Turn repetitive AI chores into one-click buttons — on your own machine, against your own git repo.

Describe a chore — release notes from your git log, a PR review, a morning briefing — as a small YAML file in your repo. Kiri runs it on your machine, shell steps piped into model steps, and writes the result up as an **article**: a readable page in a live feed, not scrollback in a terminal. Bring your own model — Anthropic, OpenAI, or any OpenAI-compatible endpoint. No cloud, no daemons: kiri runs only while the app is open.

```yaml
# workflows/release-notes.yaml
name: Release Notes
steps:
  - sh: git log --oneline v1.4.0..HEAD
    name: Collect changes
  - llm:
      model: anthropic:claude-haiku-4-5
      prompt: |
        Rewrite these commits as release notes,
        grouped under Features and Fixes.

        {{KIRI_INPUT}}
    id: draft
    name: Draft the notes
articles:
  - slug: release-notes
    llm:
      model: anthropic:claude-haiku-4-5
      prompt_file: prompts/release-notes.tpl   # reads {{DRAFT}}
    env:
      DRAFT:
        step: draft
```

**📖 Full documentation → [kiri.build/docs](https://kiri.build/docs)**

## Two ways to work

- **Workflows** — scripted chores like the one above. Chain shell commands, reusable script bundles (e.g. one that spawns Claude Code), and first-party model completions. Runs produce articles — markdown with inline charts and diagrams — and can recommend one-click follow-ups. Reach for a workflow when you know the shape of the work.
- **Sessions** — open-ended, streaming chat with the same models, plus tools from MCP servers you configure (web search, your issue tracker, anything MCP speaks). MCP tool calls are approval-gated, built-in article tools let a session write and revise articles of its own, and built-in workflow tools let it run your workflows for you — and author new ones: work something out in chat, then have the session save it as a validated workflow YAML in your repo (writes and runs approval-gated too). A workspace `kiri.md` plus optional personas shape the system prompt. Reach for a session when you don't yet know the shape of the work.

Both land in a single activity feed.

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

## Trust model

Kiri runs `sh:` steps and `bundles/<name>/run.sh` with **your user's permissions** — there's no sandbox, so read scripts before you run them, like any shell script. The defences kiri does provide are external: the HTTP API binds to `127.0.0.1` only and requires an `X-Kiri-Client` header on state-changing requests. More in [Trust & security](https://kiri.build/docs/trust-and-security).

## Learn more

- **[kiri.build/docs](https://kiri.build/docs)** — full documentation: workflows, recipes, sessions, providers, the CLI.
- [`examples/`](./examples/) — a complete, runnable example workspace.
- [`docs/design-notes.md`](./docs/design-notes.md) — architecture and design invariants.
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — repo setup and dev workflow.
