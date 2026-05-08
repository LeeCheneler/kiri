# claude-code bundle

A workflow step that spawns the Claude Code CLI with a permission
allowlist synthesised from the workflow's `env:` block.

Minimal usage — only `PROMPT_FILE` is required, everything else has
sensible defaults:

```yaml
- use: claude-code
  env:
    PROMPT_FILE: prompts/my-prompt.tpl
```

Full reference, all knobs explicit:

```yaml
- use: claude-code
  env:
    PROMPT_FILE: prompts/my-prompt.tpl   # required
    MAX_TURNS: "8"                       # optional, default "8"
    ALLOWED_TOOLS: "Read,Glob,Grep"      # optional, default "Read,Glob,Grep"
    MODEL: opus                          # optional, no default — claude picks
```

## Env-var contract

| Var | Required | Default | Description |
| --- | --- | --- | --- |
| `PROMPT_FILE` | yes | — | Path to the prompt template, resolved against `KIRI_REPO_ROOT`. |
| `MAX_TURNS` | no | `8` | Hard cap on the number of agent turns. |
| `ALLOWED_TOOLS` | no | `Read,Glob,Grep` | Comma-separated tool names, e.g. `Read,Glob,Grep` or `Bash(gh pr view:*)`. Defaults to read-only tooling. |
| `MODEL` | no | — | Override the model. If unset, `claude` picks its default. |

`KIRI_REPO_ROOT` is supplied by kiri.

## What `run.sh` does

1. Synthesises `<scratch>/.claude/settings.json` with `permissions.allow`
   from `ALLOWED_TOOLS` and points `CLAUDE_CONFIG_DIR` at it. No
   user-level `~/.claude/settings.json` is consulted — the workflow
   YAML is the only source of permission truth.
2. Reads the previous step's stdout (piped here by kiri) into
   `KIRI_INPUT` and renders `$KIRI_REPO_ROOT/$PROMPT_FILE` —
   substituting `{{VAR}}` placeholders from the environment (see
   *Prompt templates* below).
3. Prepends "You have access to: …. If you need anything else, end
   the session with a final message describing what you needed and
   why." to the rendered prompt so the agent doesn't burn turns on
   denied tools.
4. Spawns `claude -p "$PROMPT" --max-turns "$MAX_TURNS"` (plus
   `--model "$MODEL"` if set). The agent's final message lands on
   stdout and shows up in the run feed.

## Prompt templates

Prompt files support `{{VAR}}` placeholders, substituted from the
environment in a single left-to-right pass. Names must be uppercase
letters, digits, or underscores (matching the env-var convention).
Unknown vars resolve to empty. Substituted values are not re-scanned,
so a value that itself contains `{{X}}` stays literal — no infinite
loops on self-referential content.

### Substitutable vars

| Var | Source |
| --- | --- |
| `{{KIRI_INPUT}}` | Previous step's stdout (one trailing newline trimmed). |
| `{{KIRI_RUN_ID}}` | Kiri-injected run identifier. |
| `{{KIRI_STEP_INDEX}}` | Zero-based index of this step in the run. |
| `{{KIRI_REPO_ROOT}}` | Absolute path of the workflow repo root. |
| `{{KIRI_BUNDLE_DIR}}` | Absolute path of this bundle's directory. |
| `{{KIRI_META_FILE}}` | Path the bundle writes step metadata to. |
| `{{PROMPT_FILE}}`, `{{MAX_TURNS}}`, `{{ALLOWED_TOOLS}}`, `{{MODEL}}` | Bundle env-var contract values (defaulted as documented above). |
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

The `claude` CLI and `jq` must both be on `PATH` (`awk` and
POSIX `sh` are assumed). The bundle fails with a clear error at the
top of the run if either is missing.

## Cost capture (deferred)

A later iteration will switch the spawn to `--output-format json`,
parse the transcript for `cost_usd`, `tokens_in`, `tokens_out`,
and `model`, and write them to `$KIRI_META_FILE` so the feed entry
shows cost in its header.
