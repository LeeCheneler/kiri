# Getting started

Install kiri, scaffold a workspace, and run your first workflow.

## Install

Kiri ships for **macOS on Apple silicon (ARM64)**. The fastest path is Homebrew,
which auto-taps [LeeCheneler/homebrew-kiri](https://github.com/LeeCheneler/homebrew-kiri)
on first install:

```sh
brew install LeeCheneler/kiri/kiri
kiri --version
```

To upgrade later: `brew upgrade kiri`.

### Without Homebrew

Download the macOS ARM64 binary from the
[latest release](https://github.com/LeeCheneler/kiri/releases/latest), make it
executable, clear the macOS quarantine flag, and put it on your `$PATH`:

```sh
chmod +x ~/Downloads/kiri
xattr -d com.apple.quarantine ~/Downloads/kiri
sudo mv ~/Downloads/kiri /usr/local/bin/kiri
kiri --version
```

Want another platform? [Open an issue](https://github.com/LeeCheneler/kiri/issues).
Building from source is covered in
[CONTRIBUTING.md](https://github.com/LeeCheneler/kiri/blob/main/CONTRIBUTING.md).

## Quick start

Kiri runs **per directory** — each working directory is its own workspace.
Scaffold a starter workflow and launch:

```sh
cd ~/projects/some-workspace
kiri init    # scaffold a starter workflow and config
kiri         # boot on :4242
```

Then open [local.kiri.build](https://local.kiri.build) (or
`http://localhost:4242`) and click **Run** on the starter workflow — it
declares one input, so a small form opens first asking who to greet.

To pin a fixed workspace regardless of where you launch from, set
`KIRI_CONFIG_DIR` (a leading `~` is expanded). It applies to both `kiri init` and
the server:

```sh
KIRI_CONFIG_DIR=~/projects/some-workspace kiri
```

`kiri init` never overwrites existing files; it only creates what's missing, and
it always refreshes the editor JSON Schemas. See the
[CLI reference](/docs/cli-reference) for everything it scaffolds.

## Your first workflow

Workflows live in `workflows/*.yaml`. Each has a name and one or more steps:

```yaml
name: hello
steps:
  - sh: echo "hello world"
```

Edits are picked up live — no restart needed. Runs surface in the activity feed
on [local.kiri.build](https://local.kiri.build). From here, read
[Workflows](/docs/workflows) for step types, inputs, piping, articles,
and recommendations.

## Configuration

Kiri keeps configuration as **convention-based files in your repo**, not one
monolithic settings file.

- **`kiri.yaml`** (workspace root, kept in git) is kiri's structured config. It
  holds your LLM providers under `providers:` and MCP servers for sessions
  under `mcp:`. Both are optional — a workspace with only `sh:`/`use:` steps
  needs neither. `kiri init` writes a commented skeleton you can fill in. Full
  detail in [LLM providers](/docs/llm-providers) and
  [Agentic sessions](/docs/agentic-sessions).
- **`.env`** (workspace root, **git-ignored**) holds secrets. Kiri auto-loads it
  from the workspace directory at boot, so a workspace pinned with
  `KIRI_CONFIG_DIR` reads the right `.env` even when you launch from elsewhere.
  Ambient environment variables win over `.env` on a name clash.
- **`kiri.md`** and **`personas/`** shape agentic sessions — see
  [Agentic sessions](/docs/agentic-sessions).

### Configuration health

Kiri **reports** configuration problems rather than blocking on them. It prints a
health report at startup and shows the same checks in-app as a banner on the
activity page. What counts as a problem is contextual:

- A workspace with no providers is fine (**degraded**, not an error) until an
  `llm:` step needs one.
- A declared provider whose API-key env var is unset, or an unparseable
  `kiri.yaml`, is flagged as an **error**.
- A declared MCP server whose `{ env: }` var is unset is flagged as an
  **error**, naming the server.

Edits to `kiri.yaml` update the in-app banner live. If something isn't working,
[Troubleshooting](/docs/troubleshooting) starts here.

## Next steps

- [Workflows](/docs/workflows) — the full pipeline anatomy.
- [LLM providers](/docs/llm-providers) — wire up Anthropic, OpenAI, or a local server.
- [Examples](/docs/examples) — a complete, runnable workspace to copy from.
