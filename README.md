# Kiri

> A local-first AI workbench for workflows and agentic sessions — on your own machine, against your own git repo.

Define a workflow or open an agentic session, run it against your machine and repo, and publish the result. Bring your own model — Anthropic, OpenAI, or any OpenAI-compatible endpoint. Kiri runs only while the app is open: no daemons, no scheduler, no cloud.

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
    name: Draft the notes
publish:
  - slug: release-notes
    llm:
      model: anthropic:claude-haiku-4-5
      prompt_file: prompts/release-notes.tpl
```

**📖 Full documentation → [kiri.build/docs](https://kiri.build/docs)**

## Two ways to work

- **Workflows** — versioned YAML pipelines. Chain shell commands (`sh:`), reusable script bundles (`use:`, e.g. one that spawns an agentic CLI like Claude Code), and first-party model completions (`llm:`); pipe each step into the next; publish the run as a markdown article with inline charts and Mermaid diagrams. A run can even propose one-click follow-ups.
- **Agentic sessions** — open-ended, streaming chat against your configured models, with your workspace context and tools from MCP servers you configure (e.g. web search via the Tavily MCP server). Each tool has an Always allow / Ask / Off permission set on the MCP page, with Ask tools prompting per call (Allow / Always allow / Deny). A layered system prompt — a workspace `kiri.md` plus optional `personas/` — shapes every session.

Both stream into a single activity feed.

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

From here, the [getting-started guide](https://kiri.build/docs/getting-started) covers configuration, model providers, and your first real workflow.

## Trust model

Kiri runs `sh:` steps and `bundles/<name>/run.sh` with **your user's permissions** — there's no sandbox, so read scripts before you run them, like any shell script. The defences kiri does provide are external: the HTTP API binds to `127.0.0.1` only and requires an `X-Kiri-Client` header on state-changing requests. More in [Trust & security](https://kiri.build/docs/trust-and-security).

## Learn more

- **[kiri.build/docs](https://kiri.build/docs)** — full documentation: workflows, providers, sessions, the CLI, and examples.
- [`examples/`](./examples/) — a complete, runnable example workspace.
- [`docs/design-notes.md`](./docs/design-notes.md) — architecture and design invariants.
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — repo setup and dev workflow.
