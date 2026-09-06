# Models & providers

`llm:` steps and sessions both call models through a provider registry you
declare once in `kiri.yaml`. A `model` id is `provider:model` — the prefix
names a registry entry, the rest is the provider's own model id.

```yaml
# kiri.yaml (workspace root, kept in git)
# yaml-language-server: $schema=.kiri/kiri.schema.json

providers:
  anthropic:                  # entry name = the provider: prefix in a model id
    type: anthropic
    api_key:
      env: ANTHROPIC_API_KEY  # always an env reference, never a literal
  local:
    type: openai-compatible
    base_url: http://localhost:1234/v1
```

```yaml
- llm:
    model: anthropic:claude-haiku-4-5   # provider : model
    prompt: |
      Summarise the following in three bullets.

      {{DATA}}
  env:
    DATA: { step: fetch }
- llm:
    model: local:llama-3.1-8b
    prompt_file: prompts/review.tpl
```

A bare `model: claude-haiku` with no prefix is a load-time error. The
`providers:` map is optional — a workspace with only `sh:`/`use:` steps
needs none.

## Provider types

| `type` | For | `base_url` |
| --- | --- | --- |
| `anthropic` | Anthropic's API | optional override |
| `openai` | OpenAI's API | optional override |
| `openai-codex` | Codex using your ChatGPT subscription login | not allowed |
| `openai-compatible` | Any OpenAI-compatible server — LM Studio, Ollama, vLLM, … | **required** |

## Keys stay out of git

An `api_key` is only ever a `{ env: <NAME> }` reference — a literal key string
is rejected. Put the value in your git-ignored workspace `.env` (kiri
auto-loads it at boot) or your ambient environment; it's read at run time, and
a missing var fails the step cleanly.

```sh
# .env  (workspace root, git-ignored)
ANTHROPIC_API_KEY=sk-ant-...
```

## Codex with a ChatGPT subscription

Use `openai-codex` to call the Codex backend with your ChatGPT subscription
login. Install the Codex CLI and configure file credential storage in
`~/.codex/config.toml` (or `$CODEX_HOME/config.toml`):

```toml
cli_auth_credentials_store = "file"
```

Then sign in with your ChatGPT account:

```sh
codex login
```

Codex also supports OS keyring storage, which Kiri cannot read. See the
[Codex authentication guide](https://learn.chatgpt.com/docs/auth) for login
and credential-storage options.

Add a provider to your workspace's `kiri.yaml`:

```yaml
providers:
  codex:
    type: openai-codex
```

Choose a `codex:<model-id>` in the model picker. The name `codex` is yours to
choose; model IDs come from the account's Codex catalogue and may differ
from OpenAI's API catalogue. Use those same references in text shortcuts,
delegates, `models.utility`, and workflow `llm:` steps.

Kiri reads `auth.json` under `CODEX_HOME` (default `~/.codex`) for each
request. It never writes the file, uses a refresh token, or starts Codex.
When the access token expires or is rejected, run `codex login` and retry.
If Codex has already updated the file during normal use, Kiri picks up the
new credentials automatically. No Kiri restart is needed. Returning to the
app rechecks the health banner; a local expiry check does not verify backend
access. Keep the credential file out of your repository and shared logs.

Sessions support streaming, tools, token usage, and image input when the
model advertises it. Utility calls and `llm:` steps collect the streamed
response into their usual final text result. Effort is clamped to the
model's advertised levels. This provider offers neither image generation
nor audio transcription; configure another provider for those capabilities.

The provider rejects `api_key` and `base_url`. It never falls back to
`OPENAI_API_KEY`; requests use your Codex account's entitlements and limits.
A separate `type: openai` provider continues to use API billing.

This integration uses the Codex backend rather than the public OpenAI API.
Its endpoint and model-listing protocol, including the required client
version, may change and require a Kiri update.

## Gateways and local models

Any OpenAI-compatible endpoint is one `openai-compatible` entry with a
`base_url`. A hosted gateway like OpenRouter takes a key; a local server —
LM Studio, Ollama, vLLM — needs none when it has no auth:

```yaml
providers:
  openrouter:
    type: openai-compatible
    base_url: https://openrouter.ai/api/v1
    api_key: { env: OPENROUTER_API_KEY }
  local:
    type: openai-compatible
    base_url: http://localhost:1234/v1
```

Everything that takes a `model:` — pipeline steps, articles, summarisers,
sessions — accepts `openrouter:google/gemini-3.7-flash` or
`local:<model-id>` the same as a hosted first-party provider.

## Model shortcuts

Name the models you actually use per modality — text and image — under
`models.shortcuts:`, with any names you like:

```yaml
models:
  shortcuts:
    text:
      sonnet: anthropic:claude-sonnet-4-5
      haiku: anthropic:claude-haiku-4-5
    image:
      images: openai:gpt-image-1
```

Shortcuts are offered first when picking a model, and every new session
starts on the first shortcut of each modality. Re-point a shortcut any time
— future picks follow it; past sessions keep the model they ran on.

## Delegate models

Optionally set the models delegated workers run under `models.delegates:`,
and worker model choice becomes a deliberate size decision. Three roles, each
optional:

- **quick** — mechanical, fully-specified legwork with no judgement calls.
- **daily** — the default for ordinary work.
- **deep** — work whose outcome hinges on reasoning depth.

```yaml
models:
  delegates:
    quick: anthropic:claude-haiku-4-5
    daily: anthropic:claude-sonnet-4-5
    deep: anthropic:claude-opus-4-5
```

With any roles configured, the assistant names one per task it
[delegates](/docs/sessions) and the worker runs that role's model, resolved
at spawn. Without them, workers run the same model as the conversation.

## Utility model

Optionally set the model kiri itself uses for small internal generations —
naming a new session off its opening message, judging shell commands under
the Auto permission and distilling your approval decisions into the
precedent that judgement reads, suggesting tap-to-send replies after a
turn, or tidying a push-to-talk transcript into the message you meant —
under `models.utility:`:

```yaml
models:
  utility: anthropic:claude-haiku-4-5
```

These calls are tiny, so a fast, cheap model is the right fit — a
[local model](#gateways-and-local-models) works well and keeps them off the meter
entirely. Unset, session titling falls back to the session's own model,
the shell tool's Auto permission falls back to asking on every command,
suggested replies stay off, and push-to-talk lands the raw transcript.

## Transcription model

Optionally set the speech-to-text model behind push-to-talk in the session
composer, under `models.transcription:`. Hold the button, speak, let go: the
recording is transcribed by this model and, with a utility model configured,
tidied into the message you meant before it lands in the draft.

```yaml
models:
  transcription: openrouter:openai/whisper-1
```

Any `openai` or `openai-compatible` provider that serves the OpenAI-style
`/audio/transcriptions` endpoint works — OpenRouter does, with its
speech-to-text catalogue (`openai/whisper-1`, `openai/gpt-4o-transcribe`,
`deepgram/nova-3`, …), as does a local speech server that implements the
same endpoint. Unset, push-to-talk stays off.

## Hot reload and health

Edits to `kiri.yaml` apply live; an invalid edit keeps the last-known-good
config. Problems — an unset key variable, a reference to an undeclared
provider, or expired Codex credentials — never block boot: they're flagged in the boot report and the
in-app health banner. See [Troubleshooting](/docs/troubleshooting).

Every `kiri.yaml` field is listed in the
[kiri.yaml reference](/docs/kiri-yaml); the full `llm:` step contract —
prompts, templating, data flow — is in the
[workflow reference](/docs/workflow-reference).
