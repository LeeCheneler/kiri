# Kiri

**キリト** — short for Kirito, the protagonist of *Sword Art Online*.

A local-first, git-based workflow orchestrator for personal automation. Triggered by cron, manual invocation, or AI agents via MCP. Activity feed as the main UI surface, not a node-graph canvas. Single user, app-active scope — workflows run while kiri is open, no daemons.

## Install

> Pre-built binaries will appear on the [Releases page](https://github.com/LeeCheneler/kiri/releases) once `v0.1.0` is cut. Until then, see [CONTRIBUTING.md](./CONTRIBUTING.md) for run-from-source instructions.

Download the macOS ARM64 binary from the [latest release](https://github.com/LeeCheneler/kiri/releases/latest), make it executable, and put it on your `$PATH`:

```sh
chmod +x ~/Downloads/kiri
mv ~/Downloads/kiri /usr/local/bin/kiri
kiri --help
```

Other platforms aren't built yet — [open an issue](https://github.com/LeeCheneler/kiri/issues) if you'd like one.

## Use

Kiri runs per-directory: each working directory is its own workspace.

```sh
cd ~/projects/some-workspace
kiri init    # scaffold workflows/, scripts/claude-code/, prompts/
kiri         # boot the orchestrator on :4242
```

Then open **https://local.kiri.build** in your browser. The hosted shell at that URL loads kiri's UI from your locally-running process. Bookmark it — same URL across machines and projects.

> **Safari / Brave note.** Both browsers block HTTP-localhost subresource loads from an HTTPS page, so the shell won't fetch kiri's bundle there. Use **http://localhost:4242** directly on those browsers. Chrome and Firefox work either way.

The bundled `example` workflow is a 2-step pipeline that calls Claude Code. Click **Run** in the UI, then refresh the feed to see the result. You'll need the [Claude Code CLI](https://docs.claude.com/en/docs/claude-code) on your `$PATH`, signed in.

## Learn more

- [`docs/design-notes.md`](./docs/design-notes.md) — architecture, workflows, script bundles, MCP, todos.
- [`docs/milestones.md`](./docs/milestones.md) — what's shipped and what's next.
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — repo setup, dev workflow, deploying the shell.
