# Kiri

> An AI workspace that runs on your machine and writes things down — sessions become readable pages, facts become memories, and repeated chores become one-click buttons.

Every AI tool you use forgets. Chats scroll away, context gets re-explained, and the same chore gets re-prompted every week. Kiri is a **local-first AI workspace** built so work compounds instead:

1. **Work it out in chat.** Open a session with any model you configure — wired into your files, your shell, and any MCP server, with tool permissions you set: allow, ask, or off.
2. **Keep what matters.** Output lands as **articles**: readable pages in a live feed, with charts and diagrams, not scrollback. Facts persist as memories; related work compounds into a project's shared, cross-linked corpus.
3. **Automate the repeats.** Anything worth doing twice hardens into a **workflow** — a YAML file in your repo, runnable as a one-click button. A session can author it for you.

Bring your own model — Anthropic, OpenAI, or any OpenAI-compatible endpoint. Nothing leaves your machine except the model calls you configure, and kiri only runs while the app is open.

```yaml
# workflows/release-notes.yaml — a chore, hardened into a button
name: Release Notes
steps:
  - sh: git log --oneline v1.4.0..HEAD
    id: commits
    name: Collect changes
  - llm:
      model: anthropic:claude-haiku-4-5
      prompt: |
        Rewrite these commits as release notes,
        grouped under Features and Fixes.

        {{COMMITS}}
    id: draft
    name: Draft the notes
    env:
      COMMITS:
        step: commits
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

## Highlights

- **Sessions are the front door.** Streaming chat with your models, extended by any MCP server you configure — web search, your issue tracker, anything MCP speaks.
- **Hands on your repo, on a leash.** Sessions find, read, and edit files and run builds, tests, and git — confined to directories you allow. Every write shows as a diff and asks first; shell approvals can go **Auto**, where a hard deterministic screen always stops the dangerous stuff and a small judge model waves through the boring stuff.
- **Everything is written down.** Sessions and runs alike produce articles — markdown with inline charts and diagrams — collected in one live feed with a view for just the writing.
- **Memories and projects.** Sessions save durable facts every future session recalls. Group work into a project and its sessions share an article corpus with `[[wiki-links]]`, their own memories, and standing instructions.
- **Chat graduates into automation.** Work something out in a session, then have it author the workflow — validated YAML written into your repo, ready as the next button.
- **Workflows are buttons.** Shell steps feeding model steps through declared refs; rerun forever with one click, and runs can recommend one-click follow-ups.
- **Delegated research.** A session can hand legwork to a hidden worker that reports back only its findings — the worker never holds a tool you haven't already set to always-allow.
- **Search everything.** ⌘K from anywhere, across articles, transcripts, run summaries, and workflow names — results as you type.

Sessions can also generate images inline, load workspace skills on demand, and layer standing instructions from `kiri.md`, a project, and `AGENTS.md` files — the [sessions docs](https://kiri.build/docs/sessions) cover the lot.

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
