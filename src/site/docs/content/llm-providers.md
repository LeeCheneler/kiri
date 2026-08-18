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
turn, or tidying a dictated draft on request — under `models.utility:`:

```yaml
models:
  utility: anthropic:claude-haiku-4-5
```

These calls are tiny, so a fast, cheap model is the right fit — a
[local model](#gateways-and-local-models) works well and keeps them off the meter
entirely. Unset, session titling falls back to the session's own model,
the shell tool's Auto permission falls back to asking on every command,
and suggested replies and draft tidying stay off.

## Hot reload and health

Edits to `kiri.yaml` apply live; an invalid edit keeps the last-known-good
config. Problems — an unset key variable, a reference to an undeclared
provider — never block boot: they're flagged in the boot report and the
in-app health banner. See [Troubleshooting](/docs/troubleshooting).

Every `kiri.yaml` field is listed in the
[kiri.yaml reference](/docs/kiri-yaml); the full `llm:` step contract —
prompts, templating, data flow — is in the
[workflow reference](/docs/workflow-reference).
