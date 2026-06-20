# CLI reference

Kiri is a single binary, `kiri`. Run it inside a workspace directory.

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

Run `kiri` with no command to start the server (it boots on `:4242`). Open
[local.kiri.build](https://local.kiri.build) or `http://localhost:4242`.

## kiri init

Scaffolds workflow-authoring assets in the working directory. Existing files are
**never overwritten** — only missing files are created — and the JSON Schemas are
always (re)written from the live Zod schemas, so a plain `kiri` launch also keeps
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

## Options

| Flag | Effect |
| --- | --- |
| `-h`, `--help` | Show help text. `kiri init --help` shows the init-specific help. |
| `-v`, `--version` | Print the kiri version. |

## Environment

| Variable | Effect |
| --- | --- |
| `KIRI_CONFIG_DIR` | Workspace directory to use instead of the current directory. A leading `~` is expanded to your home. Applies to both `kiri init` and the server. |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, … | API keys referenced by `kiri.yaml` providers via `{ env: <NAME> }`. Read at run time; can live in a git-ignored workspace `.env`. |
| `TAVILY_API_KEY` | Enables first-party web search in agentic sessions. Optional. |

Kiri auto-loads a workspace `.env` (from the config dir) at boot, before reading
any environment variable — so a workspace pinned with `KIRI_CONFIG_DIR` resolves
its keys from the right `.env`.

## Invoking workflows

- **Manual** — click **Run** in the UI. Workflows with `inputs:` open a modal
  first; workflows without invoke on a single click.
- **Re-run** — an existing run can be re-triggered in place from its run page.

There is no cron, file watch, webhook, or inbox polling. For polling shapes,
write a workflow whose first step does the poll and run it when you want it.
