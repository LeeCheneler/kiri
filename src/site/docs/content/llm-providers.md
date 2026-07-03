# LLM providers

First-party `llm:` steps and agentic sessions both call models through a provider
registry you declare in `kiri.yaml`. This page covers declaring providers and the
full `llm:` step contract.

## Declaring providers

Providers live under `providers:` in the workspace-root `kiri.yaml` (kept in git)
— kiri's structured config file. Each entry's name is the `provider:` prefix you
reference in a `model` id.

```yaml
# kiri.yaml
# yaml-language-server: $schema=.kiri/kiri.schema.json

providers:
  anthropic:                  # entry name = the provider: prefix in a model id
    type: anthropic           # anthropic | openai | openai-compatible
    api_key:
      env: ANTHROPIC_API_KEY  # API keys are ALWAYS { env: <NAME> } refs
  local:
    type: openai-compatible
    base_url: http://localhost:1234/v1   # required for openai-compatible
```

The `providers:` map is **optional** — a workspace with no `llm:` steps needs
none. `kiri.yaml` is canonical; `kiri.yml` also works, and if both exist
`kiri.yaml` wins (kiri warns).

## Provider types

`type` is one of:

- **`anthropic`** — Anthropic's API. `base_url` optional (override the default
  endpoint).
- **`openai`** — OpenAI's API. `base_url` optional.
- **`openai-compatible`** — any OpenAI-compatible server (LM Studio, Ollama,
  vLLM, …). `base_url` is **required**.

## API keys via env

An `api_key` is only ever a `{ env: <NAME> }` reference to an environment
variable — **a literal key string is rejected** so secrets stay out of git. The
key is read at run time; a missing env var fails the step cleanly. Put the value
in your git-ignored workspace `.env` (kiri auto-loads it) or your ambient
environment:

```sh
# .env  (workspace root, git-ignored)
ANTHROPIC_API_KEY=sk-ant-...
```

An `openai-compatible` server running locally with no auth needs no key — just a
`base_url`.

## Using a provider in an llm: step

A `model` is a `provider:model` id: the prefix names a `kiri.yaml` entry, the
rest is the provider's own model id. A bare `model: claude-haiku` with no prefix
is a load-time error.

```yaml
- llm:
    model: anthropic:claude-haiku-4-5   # provider : model
    prompt: |
      Summarise the following in three bullets.

      {{KIRI_INPUT}}
  name: Summarise
- llm:
    model: local:llama-3.1-8b
    prompt_file: prompts/review.tpl
```

## The llm: step contract

- **Exactly one of `prompt` / `prompt_file`** on a `steps:` / `publish:` entry.
  `prompt_file` resolves against the workspace root. A `summarize:` step may omit
  both for the built-in summary prompt.
- **Templating** is the same `{{VAR}}` single-pass substitution the bundles use.
  `{{KIRI_INPUT}}` carries the previous step's stdout into a pipeline step's
  prompt (one trailing newline trimmed); the step's own `env:` vars are available
  too; unknown vars resolve empty.
- **The completion text is the step's stdout** — it flows downstream, becomes the
  article, or becomes the summary, exactly like a bundle's stdout. Token counts
  land in the run timeline.
- **No file channels.** A completion can't open files, so an `llm:` step gets no
  `KIRI_RECOMMENDATIONS_FILE` (use an `sh:` or bundle step to emit
  recommendations). An `llm:` `publish:` step takes its data through
  `{ step: <id> }` / `{ article: <slug> }` env refs, rendered into the prompt
  by name (`{{DRAFT}}`); an `llm:` `summarize:` step additionally receives the
  run digest inlined as `{{KIRI_SUMMARY_CONTEXT}}` (each step's stdout capped
  at 64 KB, marked `[truncated]` past the cap).

### Zero-config summariser

A `summarize:` step can be just a model. With no `prompt` / `prompt_file`, kiri
uses a baked-in summary prompt over the injected `{{KIRI_SUMMARY_CONTEXT}}`
digest:

```yaml
summarize:
  llm:
    model: anthropic:claude-haiku-4-5   # no prompt — kiri supplies one
```

## Hot reload & config health

Edits to `kiri.yaml` are picked up live — kiri swaps the provider registry on a
valid change and re-validates each workflow's `llm:` references, keeping the
last-known-good config on an invalid edit. A declared provider whose API-key env
var is unset (or an unparseable `kiri.yaml`) is surfaced as an error in the boot
report and the in-app config-health banner, but never blocks boot. See
[Getting started → Configuration health](/docs/getting-started) and
[Troubleshooting](/docs/troubleshooting).
