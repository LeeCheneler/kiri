# lm-studio-summarizer bundle

A workflow `summarize:` step that produces a markdown summary of a run
for the activity feed, using a local LM Studio server (or any
OpenAI-compatible HTTP endpoint). Spawned by kiri after the workflow's
`steps:` complete on non-cancelled runs; this bundle's stdout becomes
the run's `summary` when it exits successfully. The feed renders the
result through the SPA's sandboxed markdown component, so the baked-in
prompt produces a single sentence for one-shot results and a bullet
list for list-style results.

## Usage

Reference it from a workflow's `summarize:` field — no env vars
needed:

```yaml
name: my-workflow
steps:
  - sh: echo "hello"
summarize:
  use: lm-studio-summarizer
```

Or override the prompt, model, base URL, or token cap directly from
the workflow YAML:

```yaml
summarize:
  use: lm-studio-summarizer
  env:
    PROMPT: "One witty sentence about this run. Context lives at {{KIRI_RUN_CONTEXT_FILE}}."
    MODEL: gemma-3-12b
```

Full reference, all knobs explicit:

```yaml
summarize:
  use: lm-studio-summarizer
  env:
    PROMPT: "Inline prompt text."          # optional; wins over PROMPT_FILE
    PROMPT_FILE: prompts/my-summary.tpl    # optional
    MODEL: gemma-3-12b                     # optional, server uses loaded model when unset
    BASE_URL: http://localhost:1234/v1     # optional, default LM Studio HTTP server
    MAX_TOKENS: "2048"                     # optional, default 2048
```

## Env-var contract

| Var | Required | Default | Description |
| --- | --- | --- | --- |
| `PROMPT` | no | baked-in summariser prompt | Inline prompt text. Wins over `PROMPT_FILE` when both are set. |
| `PROMPT_FILE` | no | baked-in summariser prompt | Path to a prompt template. If relative, resolved against `KIRI_REPO_ROOT`; absolute paths are passed through as-is. |
| `MODEL` | no | — | Model identifier. Omitted from the request when unset; the server uses whichever model is currently loaded. |
| `BASE_URL` | no | `http://localhost:1234/v1` | OpenAI-compatible API root. Point this at Ollama's compat shim, llama.cpp's server, vLLM, etc. to repurpose the bundle. |
| `MAX_TOKENS` | no | `2048` | Hard cap on the summary length. |

`KIRI_REPO_ROOT` and `KIRI_RUN_CONTEXT_FILE` are supplied by kiri.

### Precedence

When both `PROMPT` and `PROMPT_FILE` are set, `PROMPT` wins and
`PROMPT_FILE` is ignored — its content is not read, validated, or
concatenated. When neither is set, the bundle falls back to a baked-in
prompt that inlines the run-context JSON. Matches `claude-code-summarizer`'s
precedence rule.

### Run context

`KIRI_RUN_CONTEXT_FILE` points at a JSON file under the per-run scratch
dir containing the workflow name, status, duration, and per-step
kind / status / duration / stdout / stderr / error. The bundle reads
that file at the top of `run.sh` and exposes its content as
`{{KIRI_RUN_CONTEXT}}` for the prompt-template substitution pass.

A user-supplied `PROMPT` or `PROMPT_FILE` replaces the *framing* only.
To bring the envelope content into a custom prompt, reference
`{{KIRI_RUN_CONTEXT}}` directly — this is the deterministic path for
non-agentic local models, which can't open files on their own. The
older `{{KIRI_RUN_CONTEXT_FILE}}` (just the path) remains available
for agentic bundles where the model can call a `read_file` tool.

## Zero config by design

Zero config is the default posture: a workflow declaring
`summarize: { use: lm-studio-summarizer }` with no env vars uses the
baked-in prompt and posts to the default LM Studio endpoint with
whichever model is currently loaded. The prompt asks for a single
sentence when the run produced one piece of news and a markdown bullet
list when it produced a list of items. The env vars above are escape
hatches for workflows that want to shape the summary without forking
the bundle.

If the env-var contract still isn't enough — for example you need
custom dep handling or a different CLI entirely — fork the bundle:

```
cp -r scripts/lm-studio-summarizer scripts/my-summarizer
$EDITOR scripts/my-summarizer/run.sh
```

Then reference your fork:

```yaml
summarize:
  use: my-summarizer
```

## Prompt templates

Same renderer as `lm-studio` and `claude-code` — prompts are portable
across all three bundles. `{{VAR}}` placeholders are substituted from
the environment in a single left-to-right pass. The same rules apply
to whichever source produced the prompt (`PROMPT`, `PROMPT_FILE`, or
the baked-in default). Names must be uppercase letters, digits, or
underscores. Unknown vars resolve to empty. Substituted values are
not re-scanned, so a value that itself contains `{{X}}` stays literal
— no infinite loops on self-referential content.

### Substitutable vars

| Var | Source |
| --- | --- |
| `{{KIRI_RUN_CONTEXT}}` | The run-envelope JSON content, inlined verbatim. Use this when the model can't open files itself (i.e. any non-agentic local model). |
| `{{KIRI_RUN_CONTEXT_FILE}}` | Path to the run-envelope JSON file. Only useful when the model can open files on its own. |
| `{{KIRI_RUN_ID}}` | Kiri-injected run identifier. |
| `{{KIRI_STEP_INDEX}}` | Zero-based index of this step in the run. |
| `{{KIRI_REPO_ROOT}}` | Absolute path of the workflow repo root. |
| `{{KIRI_BUNDLE_DIR}}` | Absolute path of this bundle's directory. |
| `{{KIRI_INPUT}}` | Stdin piped in by kiri — empty for `summarize:` steps today. |
| `{{BASE_URL}}`, `{{MAX_TOKENS}}` | Bundle env-var contract values, defaulted as documented above. |
| `{{MODEL}}`, `{{PROMPT}}`, `{{PROMPT_FILE}}` | Bundle env-var contract values — resolve to empty when unset. |
| Any `{{MY_VAR}}` | Anything set in the step's `env:` block. |

### Example

```yaml
summarize:
  use: lm-studio-summarizer
  env:
    PROMPT: "Read {{KIRI_RUN_CONTEXT_FILE}} and write one sentence in a {{TONE}} tone."
    TONE: dry
```

## Failure handling

A summariser failure does not affect the run's status — `runs.status`
stays `ok` or `failed` as determined by the workflow steps. The run's
`summary` field stays null when the summariser fails. The summariser's
stdout/stderr are captured on a `run_steps` row (with `is_summary`
set) so the run detail page can surface them for debugging.

## Dependencies

`curl`, `jq`, and POSIX `awk` must be on `PATH`. The bundle exits
non-zero with a clear error at the top of the run if any are missing.
`curl` must be ≥ 7.76 (for `--fail-with-body`); macOS 12+ and recent
Linux distros all qualify.

LM Studio's HTTP server must be running and reachable at `BASE_URL`.
In LM Studio: Developer tab → Server → Start Server. The default
`http://localhost:1234/v1` matches LM Studio's defaults.
