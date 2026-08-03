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
`providers:` map is optional — a workspace with only `sh:`/`use:` steps needs
none. (`kiri.yaml` is canonical; `kiri.yml` also works, and if both exist
`kiri.yaml` wins, with a warning.)

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

## Local models

Run against LM Studio, Ollama, or vLLM with an `openai-compatible` entry
pointing at the local server — no key needed when the server has no auth:

```yaml
providers:
  local:
    type: openai-compatible
    base_url: http://localhost:1234/v1
```

Everything that takes a `model:` — pipeline steps, articles, summarisers,
sessions — accepts `local:<model-id>` the same as a hosted provider.

## Model tiers

Optionally name three tiers of model per modality — text and image — under
`models:`, and model choice becomes a deliberate size decision. The names are
the three Japanese blades, smallest to largest:

- **tantō** — smallest, fastest, cheapest: mechanical, fully-specified work
  with no judgement calls.
- **katana** — the everyday default for ordinary work.
- **ōdachi** — largest and deepest: work whose outcome hinges on reasoning
  depth.

```yaml
models:
  text:
    tanto: anthropic:claude-haiku-4-5
    katana: anthropic:claude-sonnet-4-5
    odachi: anthropic:claude-opus-4-5
  image:
    tanto: openai:gpt-image-1-mini
    katana: openai:gpt-image-1
    odachi: openai:gpt-image-1
```

Each modality block is optional, but a present block defines all three tiers.
Tier values are ordinary `provider:model` references, resolved when a tier is
used — a session records the model its tier pointed at at the time, so
re-pointing a tier later changes future work without rewriting what past
sessions ran on.

With tiers configured, the session model pickers pin the three tiers ahead of
the full listing, every new session starts on tanto for each configured
modality, and the assistant sizes each worker it delegates to by naming a
tier — tantō for mechanical legwork, katana by default, ōdachi where the
result depends on reasoning depth.
Without a `models:` section, nothing changes: pickers list models as usual and
new sessions default to the most recent session's model.

Tiers and a session's [effort level](/docs/sessions) are orthogonal levers:
the tier picks *which* model does the work; effort sets *how hard* it
reasons. Size them independently.

## Hot reload and health

Edits to `kiri.yaml` apply live: kiri swaps the registry on a valid change and
re-validates every workflow's `llm:` references, keeping the last-known-good
config on an invalid edit. A declared provider whose key env var is unset is
flagged in the boot report and the in-app health banner — it never blocks
boot. See [Troubleshooting](/docs/troubleshooting).

For the full `llm:` step contract — prompts, templating, data flow — see the
[workflow reference](/docs/workflow-reference).
