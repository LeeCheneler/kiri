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

If the config-health report says a provider's API-key env var is unset,
configure that variable. Keys are `{ env: <NAME> }` refs in `kiri.yaml`; set the named variable
in your environment or your git-ignored workspace `.env`:

```sh
# .env  (workspace root)
ANTHROPIC_API_KEY=sk-ant-...
```

Kiri auto-loads `.env` from the **config dir**. If you launch with
`KIRI_CONFIG_DIR` pointed elsewhere, make sure the `.env` lives in *that*
directory, not the one you launched from.

## Codex authentication is expired or unavailable

For an `openai-codex` provider, run `codex login` with your ChatGPT account,
then return to Kiri and retry. Kiri re-reads credentials without restarting;
the health banner rechecks when you return to the app.

If Codex is signed in but Kiri reports missing file credentials, configure
`cli_auth_credentials_store = "file"` in Codex's `config.toml` and sign in
again. Kiri cannot read OS keyring credentials. Both processes must use the
same `CODEX_HOME` (default `~/.codex`). For an unreadable-file error, check
access to `auth.json` in that directory. Do not copy tokens into `kiri.yaml`.

The local expiry timestamp cannot detect revocation. A rejected request can
require another login even before that timestamp. A model-listing or protocol
error after a successful login may require updating Kiri; see
[Codex setup](/docs/llm-providers#codex-with-a-chatgpt-subscription).

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
you haven't signed into yet offers a **Connect** action — sign in and its tools
appear once kiri stores the tokens. For web search, add an MCP server that
provides it — e.g. the Tavily MCP server.

## A tool call is stuck or its result is enormous

Tool calls are bounded so neither can wedge a turn: a call that runs too long
is abandoned and reported back to the model as an error it can work around,
and an oversized result is truncated with a marker so it can't overrun the
model's context. Stopping the turn cancels any call in flight. A tool that's
routinely slow or returns far too much usually wants a narrower input (search
a specific subfolder rather than a huge tree, say).

## Edits aren't taking effect

Most files are read fresh from disk — workflow edits, skills, `kiri.yaml`, and
`kiri.md` all apply without a restart (a `kiri.yaml` edit re-validates workflows
live, keeping the last-known-good config on an invalid edit). If a change isn't
landing:

- Check the boot report / health banner for a parse error — an invalid
  `kiri.yaml` keeps the previous config.
- A `kiri.md`, project instructions, or `AGENTS.md` change applies on the
  **next turn**, not retroactively — and an `AGENTS.md` only counts when it
  sits in or above the session's working directory, inside the allowed
  directories.
- Confirm you're editing files in the active workspace (the launch dir, or
  `KIRI_CONFIG_DIR` if set).

## Common authoring mistakes

| Mistake | Fix |
| --- | --- |
| `MAX_TURNS: 50` (YAML number) | `MAX_TURNS: "50"` — `env:` values must be strings. |
| `env: { KIRI_MODE: "x" }` | Don't prefix `env:` keys with `KIRI_`. Reserved. |
| Relative path read from inside a step | Resolve against `$KIRI_REPO_ROOT` — the step's cwd is the scratch dir, not the repo root. |
| Reading the parent shell's `MY_TOKEN` | Steps don't inherit it. Pull it in under the step's `env:` with `MY_TOKEN: { env: MY_TOKEN }`. |
| Two `articles:` entries with the same `slug` | Slugs must be unique within a workflow. |
| Any step reading data via stdin | Every phase gets empty stdin. Wire data in with `{ step: <id> }` / `{ step, output }` / `{ article: <slug> }` env refs. |
| `llm: { model: claude-haiku }` (no prefix) | Use `provider:model`, e.g. `anthropic:claude-haiku-4-5`. The prefix names a `kiri.yaml` entry. |
| `api_key: sk-...` literal in `kiri.yaml` | Use `api_key: { env: ANTHROPIC_API_KEY }`. Literal keys are rejected. |
| `llm:` step writing to `$KIRI_RECOMMENDATIONS_FILE` | Not set for `llm:` steps. Use an `sh:` or bundle step. |
| Multi-line `sh:` without `set -eu` | `sh -c` doesn't stop on first failure. Start non-trivial `sh:` steps with `set -eu`. |
| `chart` block whose spec fetches remote data | Inline the data under `data.values`. Remote-data specs are rejected and degrade to a notice. |

Still stuck? [Open an issue](https://github.com/LeeCheneler/kiri/issues).
