# CLI reference

Kiri is a single binary, `kiri`. Run it inside a workspace directory.

## Install and upgrade

Kiri ships for macOS on Apple silicon. With Homebrew:

```sh
brew install LeeCheneler/kiri/kiri
```

Upgrade with `brew upgrade kiri`.

Without Homebrew, download the macOS ARM64 binary from the
[latest release](https://github.com/LeeCheneler/kiri/releases/latest), then:

```sh
chmod +x ~/Downloads/kiri
xattr -d com.apple.quarantine ~/Downloads/kiri
sudo mv ~/Downloads/kiri /usr/local/bin/kiri
kiri --version
```

Want another platform? [Open an issue](https://github.com/LeeCheneler/kiri/issues).

## Commands

```
Usage: kiri [command]

Commands:
  init           Scaffold workflow authoring assets in the working directory

Run kiri with no command to start the server.

Options:
  -h, --help     Show this help text
  -v, --version  Show kiri version
```

The server boots on `:4242` — open
[local.kiri.build](https://local.kiri.build) or `http://localhost:4242`.

## kiri init

Scaffolds workflow-authoring assets in the working directory. Existing files are
**never overwritten** — only missing files are created — and the JSON Schemas are
always regenerated from kiri's own schemas, so a plain `kiri` launch also keeps
them in sync after a binary upgrade.

```
README.md                        Workflow DSL reference and IDE/LSP setup notes
workflows/hello-world.yaml       Minimal one-step starter workflow
kiri.yaml                        Structured config (LLM providers, …) — commented
.kiri/workflow.schema.json       JSON Schema for editor validation
.kiri/kiri.schema.json           JSON Schema for kiri.yaml
```

It also adds `.kiri/` to `.gitignore` if needed. The working directory is the
current directory, or `KIRI_CONFIG_DIR` if set.

## Environment

| Variable | Effect |
| --- | --- |
| `KIRI_CONFIG_DIR` | Workspace directory to use instead of the current directory. A leading `~` is expanded to your home. Applies to both `kiri init` and the server. |
| `KIRI_PORT` | Port to serve on instead of `4242` — for a second kiri alongside a running one. The hosted shell at [local.kiri.build](https://local.kiri.build) only reaches the default port; on any other, open `http://localhost:<port>` directly. |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, … | Secrets referenced by `kiri.yaml` providers and MCP servers via `{ env: <NAME> }`. Read at run time; can live in a git-ignored workspace `.env`. |

Kiri auto-loads a workspace `.env` (from the config dir) at boot, before reading
any environment variable — so a workspace pinned with `KIRI_CONFIG_DIR` resolves
its keys from the right `.env`.

## Invoking workflows

- **Manual** — invoke from the app. Workflows with `inputs:` collect their
  values first; workflows without invoke immediately.
- **Re-run** — an existing run can be re-triggered in place.

There is no cron, file watch, webhook, or inbox polling. For polling shapes,
write a workflow whose first step does the poll and run it when you want it.

## Workspace files

| File | Purpose | In git? |
| --- | --- | --- |
| `kiri.yaml` | Model providers, connected tools, allowed directories. | Yes |
| `.env` | Provider keys and other secrets, loaded at startup. | No |
| `kiri.md` | Workspace instructions for sessions. | Yes |
| `AGENTS.md` | Instructions for a directory and its descendants. | Yes |
| `skills/` | Instructions loaded on demand. | Yes |
| `workflows/` | Workflow YAML definitions. | Yes |
| `.kiri/` | Local database, editor schemas, and run scratch space. | No |

Restart Kiri after changing `.env`. To pin a workspace regardless of where
you launch from, set `KIRI_CONFIG_DIR`.
