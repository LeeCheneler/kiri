# kiri.yaml reference

Every field of `kiri.yaml` — kiri's one structured config file, at the
workspace root, kept in git. Edits apply live; an invalid edit keeps the
last-known-good config and shows up in the health checks.

Rules that hold throughout:

- **Unknown keys are errors.** The file is validated strictly, and
  `kiri init` writes `.kiri/kiri.schema.json` so your editor validates as
  you type (`# yaml-language-server: $schema=.kiri/kiri.schema.json`).
- **Secrets are always `{ env: <NAME> }` references** — a literal key is
  rejected. Values come from your environment or the git-ignored workspace
  `.env`, auto-loaded at boot.
- Every section is optional — the empty file is valid.

```yaml
# kiri.yaml
# yaml-language-server: $schema=.kiri/kiri.schema.json
providers:
  anthropic:
    type: anthropic
    api_key: { env: ANTHROPIC_API_KEY }
models:
  shortcuts:
    text:
      haiku: anthropic:claude-haiku-4-5
mcp:
  tavily:
    type: http
    url: https://mcp.tavily.com/mcp/
    auth: oauth
filesystem:
  allowed_directories:
    - .
```

## `providers:`

The model endpoints `llm:` steps and sessions call, keyed by name — the
`provider:` prefix in every model reference. Guide:
[Models & providers](/docs/llm-providers).

| Field | Required | Description |
| --- | --- | --- |
| `type` | yes | `anthropic`, `openai`, or `openai-compatible`. |
| `base_url` | for `openai-compatible` | The endpoint's base URL. Optional override for the other types. |
| `api_key` | no | `{ env: <NAME> }` reference. Omit for a local server with no auth. |

## `models:`

Optional model configuration — all values are `provider:model` references,
resolved at use.

| Field | Description |
| --- | --- |
| `shortcuts.text` | Named text-model shortcuts, `name: provider:model`. Offered first when picking; the first entry is the default for new sessions. |
| `shortcuts.image` | Named image-model shortcuts, same shape. |
| `delegates.quick` | Worker model for mechanical, fully-specified tasks. |
| `delegates.daily` | Worker model for ordinary work — the default role. |
| `delegates.deep` | Worker model for work that hinges on reasoning depth. |
| `utility` | The model kiri itself uses for small internal generations — session titles, Auto shell judgement and its learned precedent, suggested replies, tidying a push-to-talk transcript. |
| `transcription` | The speech-to-text model behind push-to-talk in the session composer. Any `openai` or `openai-compatible` provider serving the OpenAI-style `/audio/transcriptions` endpoint — OpenRouter does. |

## `mcp:`

MCP servers whose tools are offered to sessions, keyed by name. Guide:
[Sessions](/docs/sessions).

A server is one of two shapes, discriminated on `type`:

| Field | Required | Description |
| --- | --- | --- |
| `type: stdio` | | Local server kiri spawns as a subprocess. |
| `command` | yes | Executable to spawn, e.g. `npx`. |
| `args` | no | Arguments passed to `command`. |
| `env` | no | Environment for the process — each value an `{ env: <NAME> }` reference. |

| Field | Required | Description |
| --- | --- | --- |
| `type: http` | | Remote server (Streamable HTTP). |
| `url` | yes | The server's URL. |
| `headers` | no | Static request headers — each value an `{ env: <NAME> }` reference. |
| `auth: oauth` | no | Authenticate via a browser sign-in kiri runs on demand; tokens stay out of git. |

## `filesystem:`

The directory sandbox for sessions' file and shell tools. Declaring it is
what enables the tools — absent, they aren't offered at all. Guide:
[Sessions](/docs/sessions).

| Field | Required | Description |
| --- | --- | --- |
| `allowed_directories` | yes | Directories the tools may touch, workspace-relative (`.` is the workspace itself). Absolute paths work; a leading `~` expands to your home — the whole home directory needs the quoted `"~"` form. |
| `default_working_directory` | no | Where new sessions start. Must lie inside an allowed directory; defaults to the first entry. |
