# Kiri

**キリト** — short for Kirito, the protagonist of *Sword Art Online*.

A local-first, git-based workflow orchestrator for personal automation. Triggered by cron, manual invocation, or AI agents via MCP. Activity feed as the main UI surface, not a node-graph canvas. Single user, app-active scope — workflows run while kiri is open, no daemons.

## Install

macOS ARM64 only for now — [open an issue](https://github.com/LeeCheneler/kiri/issues) if you'd like another platform.

```sh
brew install LeeCheneler/kiri/kiri
kiri --version
```

Homebrew auto-taps [`LeeCheneler/homebrew-kiri`](https://github.com/LeeCheneler/homebrew-kiri) on first install. To upgrade later, `brew upgrade kiri`.

<details>
<summary>Without Homebrew</summary>

Download the macOS ARM64 binary from the [latest release](https://github.com/LeeCheneler/kiri/releases/latest), make it executable, and put it on your `$PATH`:

```sh
chmod +x ~/Downloads/kiri
mv ~/Downloads/kiri /usr/local/bin/kiri
kiri --version
```

</details>

## Use

Kiri runs per-directory: each working directory is its own workspace.

```sh
cd ~/projects/some-workspace
kiri init    # scaffold workflows/, scripts/, prompts/
kiri         # boot the orchestrator on :4242
```

Then open **https://local.kiri.build** in your browser. The hosted shell at that URL loads kiri's UI from your locally-running process. Bookmark it — same URL across machines and projects.

> **Safari / Brave note.** Both browsers block HTTP-localhost subresource loads from an HTTPS page, so the shell won't fetch kiri's bundle there. Use **http://localhost:4242** directly on those browsers. Chrome and Firefox work either way.

`kiri init` scaffolds two starter workflows — **PR Review Queue** (queries `gh` for PRs awaiting your review) and **HackerNews Digest** (fetches the HN top stories and publishes them as a markdown artefact) — plus the `claude-code` and `claude-code-summarizer` bundles they use. Click **Run** on either in the UI, then watch the feed. You'll need the [Claude Code CLI](https://docs.claude.com/en/docs/claude-code) on your `$PATH`, signed in.

## Trust model

Kiri runs scripts with **your user's permissions**. Bundles under `scripts/<name>/run.sh` and inline `sh:` steps in your workflow YAML are shell scripts you wrote (or pasted into your own repo) — kiri does not sandbox them. Treat them like any shell script you'd run yourself: read it before you use it.

The defences kiri *does* provide are external: the HTTP API binds to `127.0.0.1` only and requires a custom `X-Kiri-Client` header on state-changing requests, so other browser tabs and arbitrary LAN clients can't trigger workflow runs.

## Learn more

- [`docs/design-notes.md`](./docs/design-notes.md) — architecture, workflows, script bundles, MCP, todos.
- [`docs/milestones.md`](./docs/milestones.md) — what's shipped and what's next.
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — repo setup, dev workflow, deploying the shell.
