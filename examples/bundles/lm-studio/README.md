# lm-studio bundle

A workflow step that sends a one-shot chat completion to a local
LM Studio server (or any OpenAI-compatible HTTP endpoint). Prompt is
rendered from an inline string (`PROMPT`) or a template file
(`PROMPT_FILE`). Exactly one is required.

Minimal usage — inline prompt:

```yaml
- use: lm-studio
  env:
    PROMPT: "Summarise {{KIRI_INPUT}} in one sentence."
```

Or from a template file:

```yaml
- use: lm-studio
  env:
    PROMPT_FILE: prompts/my-prompt.tpl
```

Full reference, all knobs explicit:

```yaml
- use: lm-studio
  env:
    PROMPT: "Inline prompt text."          # one of PROMPT / PROMPT_FILE required
    PROMPT_FILE: prompts/my-prompt.tpl     # one of PROMPT / PROMPT_FILE required
    MODEL: gemma-3-12b                     # optional, server uses loaded model when unset
    BASE_URL: http://localhost:1234/v1     # optional, default LM Studio HTTP server
    MAX_TOKENS: "2048"                     # optional, default 2048
    TEMPERATURE: "0.7"                     # optional, server default applies when unset
```

## Env-var contract

| Var | Required | Default | Description |
| --- | --- | --- | --- |
| `PROMPT` | one of `PROMPT` / `PROMPT_FILE` | — | Inline prompt text. Wins over `PROMPT_FILE` when both are set. |
| `PROMPT_FILE` | one of `PROMPT` / `PROMPT_FILE` | — | Path to a prompt template. If relative, resolved against `KIRI_REPO_ROOT`; absolute paths are passed through as-is. |
| `MODEL` | no | — | Model identifier. Omitted from the request when unset; the server uses whichever model is currently loaded. |
| `BASE_URL` | no | `http://localhost:1234/v1` | OpenAI-compatible API root. Point this at Ollama's compat shim, llama.cpp's server, vLLM, etc. to repurpose the bundle. |
| `MAX_TOKENS` | no | `2048` | Hard cap on the completion length. |
| `TEMPERATURE` | no | — | Sampling temperature. Omitted from the request when unset, so the server's own default applies. |

`KIRI_REPO_ROOT` is supplied by kiri.

### Precedence

When both `PROMPT` and `PROMPT_FILE` are set, `PROMPT` wins and
`PROMPT_FILE` is ignored — its content is not read, validated, or
concatenated. Mirrors `claude-code`'s precedence rule.

## What `run.sh` does

1. Reads the previous step's stdout into `KIRI_INPUT` and renders the
   prompt — sourced from `PROMPT` or `$KIRI_REPO_ROOT/$PROMPT_FILE` —
   substituting `{{VAR}}` placeholders from the environment (see
   *Prompt templates* below).
2. Builds the JSON request body via `jq`, so the prompt is escaped
   correctly regardless of quotes, newlines, or backslashes.
3. POSTs to `$BASE_URL/chat/completions` with `curl --fail-with-body`,
   extracts `choices[0].message.content`, and prints it on stdout.

Non-streaming, no tool use, single completion in, text out.

## Prompt templates

Same renderer as `claude-code` — prompts written for one bundle work
in the other. `{{VAR}}` placeholders are substituted from the
environment in a single left-to-right pass. Names must be uppercase
letters, digits, or underscores. Unknown vars resolve to empty.
Substituted values are not re-scanned, so a value containing
`{{X}}` stays literal — no infinite loops on self-referential content.

### Substitutable vars

| Var | Source |
| --- | --- |
| `{{KIRI_INPUT}}` | Previous step's stdout (one trailing newline trimmed). |
| `{{KIRI_RUN_ID}}` | Kiri-injected run identifier. |
| `{{KIRI_STEP_INDEX}}` | Zero-based index of this step in the run. |
| `{{KIRI_REPO_ROOT}}` | Absolute path of the workflow repo root. |
| `{{KIRI_BUNDLE_DIR}}` | Absolute path of this bundle's directory. |
| `{{BASE_URL}}`, `{{MAX_TOKENS}}` | Bundle env-var contract values, defaulted as documented above. |
| `{{MODEL}}`, `{{TEMPERATURE}}`, `{{PROMPT}}`, `{{PROMPT_FILE}}` | Bundle env-var contract values — resolve to empty when unset. |
| Any `{{MY_VAR}}` | Anything set in the workflow's `env:` block. |

## Example: local triage in front of a cloud agent

The intended use shape — a cheap local model filters input so the
cloud step only runs on the survivors:

```yaml
name: filtered-pr-review
steps:
  - sh: gh search prs --review-requested=@me --state=open --json title,url,body
  - use: lm-studio
    env:
      MODEL: gemma-3-12b
      PROMPT: |
        From this JSON list of PRs, output only those that look
        substantive — drop version bumps, dependabot, and lockfile
        churn. One PR per line as "<title> — <url>", nothing else.

        {{KIRI_INPUT}}
  - use: claude-code
    env:
      MODEL: sonnet
      PROMPT: |
        Review each PR below: check out the branch, read the diff,
        leave inline comments.

        {{KIRI_INPUT}}
```

Local handles "is this worth my attention"; cloud only runs on what
survived the filter.

## Dependencies

`curl`, `jq`, and POSIX `awk` must be on `PATH`. The bundle exits
non-zero with a clear error at the top of the run if any are missing.
`curl` must be ≥ 7.76 (for `--fail-with-body`); macOS 12+ and recent
Linux distros all qualify.

LM Studio's HTTP server must be running and reachable at `BASE_URL`.
In LM Studio: Developer tab → Server → Start Server. The default
`http://localhost:1234/v1` matches LM Studio's defaults.
