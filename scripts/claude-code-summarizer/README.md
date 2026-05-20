# claude-code-summarizer bundle

A workflow `summarize:` step that produces a markdown summary of a
run for the activity feed. Spawned by kiri after the workflow's
`steps:` complete on non-cancelled runs; this bundle's stdout becomes
the run's `summary` when it exits successfully. The feed renders the
result through the SPA's sandboxed markdown component, so the
baked-in prompt produces a single sentence for one-shot results and a
bullet list for list-style results.

## Usage

Reference it from a workflow's `summarize:` field — no env vars
needed:

```yaml
name: my-workflow
steps:
  - sh: echo "hello"
summarize:
  use: claude-code-summarizer
```

Or override the prompt, model, or turn budget directly from the
workflow YAML:

```yaml
summarize:
  use: claude-code-summarizer
  env:
    PROMPT: "One witty sentence about this run. Context lives at {{KIRI_RUN_CONTEXT_FILE}}."
    MODEL: sonnet
```

Full reference, all knobs explicit:

```yaml
summarize:
  use: claude-code-summarizer
  env:
    PROMPT: "Inline prompt text."        # optional; wins over PROMPT_FILE
    PROMPT_FILE: prompts/my-summary.tpl  # optional
    MODEL: sonnet                        # optional, default haiku
    MAX_TURNS: "3"                       # optional, default 3
```

## Env-var contract

| Var | Required | Default | Description |
| --- | --- | --- | --- |
| `PROMPT` | no | baked-in summariser prompt | Inline prompt text. Wins over `PROMPT_FILE` when both are set. |
| `PROMPT_FILE` | no | baked-in summariser prompt | Path to a prompt template. If relative, resolved against `KIRI_REPO_ROOT`; absolute paths are passed through as-is. |
| `MODEL` | no | `haiku` | Passed via `--model`. |
| `MAX_TURNS` | no | `3` | Passed via `--max-turns`. Default leaves room for one Read of the envelope, the summary turn, and a follow-up Read or Grep on a large artefact. |

`KIRI_REPO_ROOT` and `KIRI_RUN_CONTEXT_FILE` are supplied by kiri.

### Precedence

When both `PROMPT` and `PROMPT_FILE` are set, `PROMPT` wins and
`PROMPT_FILE` is ignored — its content is not read, validated, or
concatenated. When neither is set, the bundle falls back to a baked-in
prompt that points Claude at the run-context JSON path and asks it to
read the envelope via its `Read` tool. Matches `claude-code`'s
precedence rule.

### Run context

`KIRI_RUN_CONTEXT_FILE` points at a JSON file under the per-run scratch
dir containing the workflow name, status, duration, per-step
kind / status / duration / stdout / stderr / error, and the published
artefacts. The baked-in default hands Claude the path (via the
`{{KIRI_RUN_CONTEXT_FILE}}` placeholder) and lets it `Read` the file
agentically — the envelope is never inlined into the prompt argv, so
runs that produce hundreds of KB of stdout don't push the prompt past
macOS `ARG_MAX` or the model's input limit. A user-supplied `PROMPT`
or `PROMPT_FILE` replaces the *framing* only — if you want the
envelope in your prompt, reference `{{KIRI_RUN_CONTEXT_FILE}}` to get
the path and tell Claude (or your own bundle) what to do with it.

## Zero config by design

Zero config is the default posture: a workflow declaring
`summarize: { use: claude-code-summarizer }` with no env vars uses
the baked-in prompt, model (`haiku`), and turn budget (`3`). The
prompt asks Claude to read the envelope, then write a single sentence
when the run produced one piece of news or a markdown bullet list
when it produced a list of items. The env vars above are escape
hatches for workflows that want to shape the summary without forking
the bundle.

If the env-var contract still isn't enough — for example you need
custom dep handling or a different CLI entirely — fork the bundle:

```
cp -r scripts/claude-code-summarizer scripts/my-summarizer
$EDITOR scripts/my-summarizer/run.sh
```

Then reference your fork:

```yaml
summarize:
  use: my-summarizer
```

## Prompt templates

`{{VAR}}` placeholders are substituted from the environment in a single
left-to-right pass. The same rules apply to whichever source produced
the prompt (`PROMPT`, `PROMPT_FILE`, or the baked-in default). Names
must be uppercase letters, digits, or underscores. Unknown vars resolve
to empty. Substituted values are not re-scanned, so a value that
itself contains `{{X}}` stays literal — no infinite loops on
self-referential content.

### Substitutable vars

| Var | Source |
| --- | --- |
| `{{KIRI_RUN_CONTEXT_FILE}}` | Path to the run-envelope JSON file. |
| `{{KIRI_RUN_ID}}` | Kiri-injected run identifier. |
| `{{KIRI_STEP_INDEX}}` | Zero-based index of this step in the run. |
| `{{KIRI_REPO_ROOT}}` | Absolute path of the workflow repo root. |
| `{{KIRI_BUNDLE_DIR}}` | Absolute path of this bundle's directory. |
| `{{KIRI_INPUT}}` | Stdin piped in by kiri — empty for `summarize:` steps today. |
| `{{MAX_TURNS}}`, `{{MODEL}}` | Bundle env-var contract values, defaulted as documented above. |
| `{{PROMPT}}`, `{{PROMPT_FILE}}` | Bundle env-var contract values — resolve to empty when unset. |
| Any `{{MY_VAR}}` | Anything set in the step's `env:` block. |

### Example

```yaml
summarize:
  use: claude-code-summarizer
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

The `claude` CLI must be on `PATH` (`awk` and POSIX `sh` are assumed).
The bundle exits non-zero with a clear error if either is missing.
