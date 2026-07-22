# Troubleshooting

Common snags and how to clear them. Kiri's boot report and the in-app
config-health banner are the first place to look — most problems show up there.

## local.kiri.build can't reach kiri

[local.kiri.build](https://local.kiri.build) is served over HTTPS but talks to
the kiri server running on your machine over plain HTTP. Some browsers — notably
**Safari and Brave** — block that as mixed content, so the interface loads but
can't connect.

If that happens, open the server directly instead:

```
http://localhost:4242
```

Same interface, served straight from your running kiri process, with no
cross-origin hop.

## A provider key is missing or invalid

If the config-health report flags a provider as an **error**, its API-key env var
is unset. Keys are `{ env: <NAME> }` refs in `kiri.yaml`; set the named variable
in your environment or your git-ignored workspace `.env`:

```sh
# .env  (workspace root)
ANTHROPIC_API_KEY=sk-ant-...
```

Kiri auto-loads `.env` from the **config dir**. If you launch with
`KIRI_CONFIG_DIR` pointed elsewhere, make sure the `.env` lives in *that*
directory, not the one you launched from.

## No providers configured

A workspace with no `providers:` in `kiri.yaml` is **degraded**, not broken —
fine until an `llm:` step runs. Add a provider (see
[Models & providers](/docs/llm-providers)) when you need one. Workflows with only
`sh:`/`use:` steps need none.

## A session tool isn't available

Session tools come from MCP servers declared under `mcp:` in `kiri.yaml`. A
server's tools appear only when it's configured and connects; one whose
`{ env: }` var is unset, or that fails to start, shows as a config-health check
naming it. Set the missing variable (in your environment or workspace `.env`)
and the server reconnects on the next `kiri.yaml` save. An `auth: oauth` server
that you haven't signed into yet shows a **Connect** button on the activity
page — click it, approve in the new tab, and its tools appear once kiri stores
the tokens. For web search, add an MCP server that provides it — e.g. the Tavily
MCP server.

## A tool call is stuck or its result is enormous

Tool calls are bounded so neither can wedge a turn. A call that runs too long is
abandoned after a time limit and reported back to the model as an error it can
work around, and a result that's too large is capped (truncated with a marker)
so it can't overrun the model's context or the provider's request-size limit. If
a call is still running and you don't want to wait, press **Escape** to stop the
turn — any call in flight shows as cancelled. A tool that's
routinely slow or returns far too much usually wants a narrower input (search a
specific subfolder rather than a huge tree, say).

## Edits aren't taking effect

Most files are read fresh from disk — workflow edits, `kiri.yaml`, `kiri.md`, and
personas all apply without a restart (a `kiri.yaml` edit re-validates workflows
live, keeping the last-known-good config on an invalid edit). If a change isn't
landing:

- Check the boot report / health banner for a parse error — an invalid
  `kiri.yaml` keeps the previous config.
- A persona or `kiri.md` change applies on the **next turn**, not retroactively.
- Confirm you're editing files in the active workspace (the launch dir, or
  `KIRI_CONFIG_DIR` if set).

## Common authoring mistakes

| Mistake | Fix |
| --- | --- |
| `MAX_TURNS: 50` (YAML number) | `MAX_TURNS: "50"` — `env:` values must be strings. |
| `env: { KIRI_MODE: "x" }` | Don't prefix `env:` keys with `KIRI_`. Reserved. |
| Relative path read from inside a step | Resolve against `$KIRI_REPO_ROOT` — the step's cwd is the scratch dir, not the repo root. |
| Reading the parent shell's `MY_TOKEN` | Won't work. Set it under the step's `env:`, or read a mode-600 file in the script. |
| Two `articles:` entries with the same `slug` | Slugs must be unique within a workflow. |
| Any step reading data via stdin | Every phase gets empty stdin. Wire data in with `{ step: <id> }` / `{ step, output }` / `{ article: <slug> }` env refs. |
| `llm: { model: claude-haiku }` (no prefix) | Use `provider:model`, e.g. `anthropic:claude-haiku-4-5`. The prefix names a `kiri.yaml` entry. |
| `api_key: sk-...` literal in `kiri.yaml` | Use `api_key: { env: ANTHROPIC_API_KEY }`. Literal keys are rejected. |
| `llm:` step writing to `$KIRI_RECOMMENDATIONS_FILE` | Not set for `llm:` steps. Use an `sh:` or bundle step. |
| Multi-line `sh:` without `set -eu` | `sh -c` doesn't stop on first failure. Start non-trivial `sh:` steps with `set -eu`. |
| `chart` block whose spec fetches remote data | Inline the data under `data.values`. Remote-data specs are rejected and degrade to a notice. |

Still stuck? [Open an issue](https://github.com/LeeCheneler/kiri/issues).
