# claude-code bundle

A workflow step that spawns the Claude Code CLI with a prompt rendered
either from an inline string (`PROMPT`) or a template file under
`prompts/` (`PROMPT_FILE`). Exactly one is required.

Minimal usage — inline prompt:

```yaml
- use: claude-code
  env:
    PROMPT: "Summarise {{KIRI_INPUT}} in one sentence."
```

Or, equivalently, from a template file:

```yaml
- use: claude-code
  env:
    PROMPT_FILE: prompts/my-prompt.tpl
```

Full reference, all knobs explicit:

```yaml
- use: claude-code
  env:
    PROMPT: "Inline prompt text."        # one of PROMPT / PROMPT_FILE required
    PROMPT_FILE: prompts/my-prompt.tpl   # one of PROMPT / PROMPT_FILE required
    MAX_TURNS: "8"                       # optional, default "8"
    MODEL: opus                          # optional, no default — claude picks
```

## Env-var contract

| Var | Required | Default | Description |
| --- | --- | --- | --- |
| `PROMPT` | one of `PROMPT` / `PROMPT_FILE` | — | Inline prompt text. Wins over `PROMPT_FILE` when both are set. |
| `PROMPT_FILE` | one of `PROMPT` / `PROMPT_FILE` | — | Path to a prompt template. If relative, resolved against `KIRI_REPO_ROOT`; absolute paths are passed through as-is. |
| `MAX_TURNS` | no | `8` | Hard cap on the number of agent turns. |
| `MODEL` | no | — | Override the model. If unset, `claude` picks its default. |

`KIRI_REPO_ROOT` is supplied by kiri.

### Precedence

When both `PROMPT` and `PROMPT_FILE` are set, `PROMPT` wins and
`PROMPT_FILE` is ignored — its content is not read, validated, or
concatenated. If neither is set, the bundle fails fast with a clear
error before invoking `claude`.

## Tool permissions

This bundle does not configure tool permissions — the agent runs with
whatever your `~/.claude/settings.json` allows. Constrain a workflow
by writing the prompt around the tools you want it to use, or set up
your global claude settings to match the strictness you want.

## What `run.sh` does

1. Reads the previous step's stdout (piped here by kiri) into
   `KIRI_INPUT` and renders the prompt text — sourced from `PROMPT`
   if set, otherwise from `$KIRI_REPO_ROOT/$PROMPT_FILE` — substituting
   `{{VAR}}` placeholders from the environment (see *Prompt templates*
   below).
2. Spawns `claude -p "$prompt" --max-turns "$MAX_TURNS"` (plus
   `--model "$MODEL"` if set). The agent's final message lands on
   stdout and shows up in the run feed.

## Prompt templates

`{{VAR}}` placeholders are substituted from the environment in a single
left-to-right pass. The same rules apply whether the prompt came from
`PROMPT` or `PROMPT_FILE`. Names must be uppercase letters, digits, or
underscores (matching the env-var convention). Unknown vars resolve to
empty. Substituted values are not re-scanned, so a value that itself
contains `{{X}}` stays literal — no infinite loops on self-referential
content.

### Substitutable vars

| Var | Source |
| --- | --- |
| `{{KIRI_INPUT}}` | Previous step's stdout (one trailing newline trimmed). |
| `{{KIRI_RUN_ID}}` | Kiri-injected run identifier. |
| `{{KIRI_STEP_INDEX}}` | Zero-based index of this step in the run. |
| `{{KIRI_REPO_ROOT}}` | Absolute path of the workflow repo root. |
| `{{KIRI_BUNDLE_DIR}}` | Absolute path of this bundle's directory. |
| `{{MAX_TURNS}}` | Bundle env-var contract value, defaulted as documented above. |
| `{{PROMPT}}`, `{{PROMPT_FILE}}`, `{{MODEL}}` | Bundle env-var contract values — resolve to empty when unset, since none have a default. |
| Any `{{MY_VAR}}` | Anything set in the workflow's `env:` block. |

### Example

```yaml
- sh: echo "Lee"
- use: claude-code
  env:
    PROMPT_FILE: prompts/greet.tpl
    TONE: cheerful
```

```
# prompts/greet.tpl
Say a {{TONE}} one-sentence hello to {{KIRI_INPUT}}.
```

Renders to: `Say a cheerful one-sentence hello to Lee.`

## Dependencies

The `claude` CLI must be on `PATH` (`awk` and POSIX `sh` are
assumed). The bundle fails with a clear error at the top of the run if
either is missing.
