import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { workflowJsonSchema } from "./workflows/index.ts";

/** Contents of the scaffolded repo-root `README.md`. */
export const KIRI_README = `# Kiri

This is a kiri workflow repo. Kiri is a local-first, git-based workflow
orchestrator — run \`kiri\` in this directory to start it and visit the local
URL it prints.

## Workflow definitions

Workflow files live in \`workflows/\` as \`*.yaml\` files. Each file defines a
single workflow. Kiri loads them on startup, validates each against
\`.kiri/workflow.schema.json\`, and registers it by \`name\`.

### Shape

\`\`\`yaml
name: my-workflow
steps:
  - use: my-bundle
    env:
      GREETING: hello
  - sh: |
      echo "post-processing"
\`\`\`

Workflows are linear pipelines — each step's output feeds the next. No
branches, conditionals, or fan-out/fan-in.

### Step variants

Each step is exactly one of:

#### \`use: <name>\`

References a **script bundle** at \`scripts/<name>/run.sh\`. A bundle is a
folder containing at minimum \`run.sh\` plus any sidecar files it needs.
Kiri spawns the bundle's \`run.sh\` directly (no shell interpolation).

\`\`\`yaml
- use: greet
  env:
    NAME: lee
\`\`\`

#### \`sh: <inline>\`

Runs an inline shell snippet via \`sh -c\`. Sugar for one-shots that don't
deserve their own bundle. Multi-line via YAML's \`|\` block scalar.

\`\`\`yaml
- sh: |
    echo "step done"
    date
\`\`\`

### Environment variables

\`env:\` is an optional flat string-to-string map passed to the step. Each
bundle defines its own contract for the keys it expects; kiri doesn't
validate values.

Kiri injects its own scoped vars on every step — \`KIRI_RUN_ID\`,
\`KIRI_STEP_INDEX\`, \`KIRI_REPO_ROOT\` — plus OS
essentials (\`PATH\`, \`HOME\`, \`USER\`, \`LOGNAME\`). These are applied
*after* user \`env:\` and overwrite on collision, so a workflow can't
shadow them. Workflow \`env:\` keys starting with \`KIRI_\` are rejected
at load time.

\`use:\` steps additionally get \`KIRI_BUNDLE_DIR\` pointing at the
bundle's source directory. Steps run with their cwd set to a per-run
scratch dir, so bundles must read sidecar files via this env var
(\`cat "$KIRI_BUNDLE_DIR/prompt.tpl"\`) rather than relative paths.

## IDE / LSP integration

Kiri publishes the workflow JSON Schema at \`.kiri/workflow.schema.json\` and
refreshes it on every startup, so editor validation and autocomplete stays in
sync after you upgrade kiri.

### VS Code (Red Hat YAML extension)

The simplest setup is a modeline at the top of each workflow file:

\`\`\`yaml
# yaml-language-server: $schema=../.kiri/workflow.schema.json
\`\`\`

Or configure \`yaml.schemas\` in your workspace \`.vscode/settings.json\`:

\`\`\`json
{
  "yaml.schemas": {
    ".kiri/workflow.schema.json": "workflows/*.yaml"
  }
}
\`\`\`

### JetBrains IDEs

Settings → Languages & Frameworks → Schemas and DTDs → JSON Schema Mappings.
Map \`.kiri/workflow.schema.json\` to \`workflows/*.yaml\`.

## Re-running \`kiri init\`

Safe — existing files are never overwritten; only the schema is refreshed.
`;

/** Contents of the scaffolded `scripts/claude-code/run.sh`. */
export const CLAUDE_CODE_RUN_SCRIPT = `#!/bin/sh
# Spawns the Claude Code CLI with the prompt taken from PROMPT (inline)
# or PROMPT_FILE (a template path resolved against KIRI_REPO_ROOT),
# rendered with {{VAR}} placeholders substituted from the environment.
# When both are set, PROMPT wins and PROMPT_FILE is ignored. Tool
# permissions are deferred to the user's own ~/.claude/settings.json —
# keeps this bundle out of the credential-resolution path so claude's
# normal login flow keeps working.
set -eu

: "\${KIRI_REPO_ROOT:?required (kiri injects this)}"

# Default exported so {{MAX_TURNS}} can be referenced inside prompt
# templates even when the workflow leaves it unset.
export MAX_TURNS="\${MAX_TURNS:-8}"

for dep in claude awk; do
  command -v "$dep" >/dev/null 2>&1 || {
    echo "claude-code bundle requires '$dep' on PATH" >&2
    exit 1
  }
done

# Resolve the prompt source. PROMPT wins over PROMPT_FILE when both
# are set. Verify the file exists *before* the awk render — POSIX
# \`set -e\` doesn't propagate failures from \`$()\` inside an
# assignment, so a missing file would otherwise silently leave
# \$prompt empty and we'd exec \`claude -p ""\`.
if [ -n "\${PROMPT:-}" ]; then
  prompt_source="$PROMPT"
elif [ -n "\${PROMPT_FILE:-}" ]; then
  [ -f "$KIRI_REPO_ROOT/$PROMPT_FILE" ] || {
    echo "claude-code: prompt file not found: $PROMPT_FILE" >&2
    exit 1
  }
  prompt_source=$(cat "$KIRI_REPO_ROOT/$PROMPT_FILE")
else
  echo "claude-code: one of PROMPT or PROMPT_FILE is required" >&2
  exit 1
fi

# Slurp the previous step's stdout (piped here by kiri) into KIRI_INPUT
# so prompts can reference {{KIRI_INPUT}}. $() trims one trailing
# newline so single-line outputs (e.g. \`echo "Lee"\`) render inline;
# multi-line outputs keep their internal newlines.
export KIRI_INPUT="$(cat)"

# Render {{VAR}} placeholders from the environment in a single
# left-to-right pass. Substituted values are not re-scanned, so a
# value containing "{{X}}" stays literal — no infinite loops on
# self-referential content. Unknown vars resolve to empty. LC_ALL=C
# pins the regex character classes to ASCII so non-C locales can't
# widen \`[A-Z]\` to accented uppercase.
prompt=$(printf '%s\\n' "$prompt_source" | LC_ALL=C awk '
  {
    out = ""
    rest = $0
    while (match(rest, /\\{\\{[A-Z_][A-Z0-9_]*\\}\\}/)) {
      name = substr(rest, RSTART + 2, RLENGTH - 4)
      out = out substr(rest, 1, RSTART - 1) ENVIRON[name]
      rest = substr(rest, RSTART + RLENGTH)
    }
    print out rest
  }
')

if [ -n "\${MODEL:-}" ]; then
  exec claude -p "$prompt" --max-turns "$MAX_TURNS" --model "$MODEL"
else
  exec claude -p "$prompt" --max-turns "$MAX_TURNS"
fi
`;

/** Contents of the scaffolded `scripts/claude-code/README.md`. */
export const CLAUDE_CODE_README = `# claude-code bundle

A workflow step that spawns the Claude Code CLI with a prompt rendered
either from an inline string (\`PROMPT\`) or a template file under
\`prompts/\` (\`PROMPT_FILE\`). Exactly one is required.

Minimal usage — inline prompt:

\`\`\`yaml
- use: claude-code
  env:
    PROMPT: "Summarise {{KIRI_INPUT}} in one sentence."
\`\`\`

Or, equivalently, from a template file:

\`\`\`yaml
- use: claude-code
  env:
    PROMPT_FILE: prompts/my-prompt.tpl
\`\`\`

Full reference, all knobs explicit:

\`\`\`yaml
- use: claude-code
  env:
    PROMPT: "Inline prompt text."        # one of PROMPT / PROMPT_FILE required
    PROMPT_FILE: prompts/my-prompt.tpl   # one of PROMPT / PROMPT_FILE required
    MAX_TURNS: "8"                       # optional, default "8"
    MODEL: opus                          # optional, no default — claude picks
\`\`\`

## Env-var contract

| Var | Required | Default | Description |
| --- | --- | --- | --- |
| \`PROMPT\` | one of \`PROMPT\` / \`PROMPT_FILE\` | — | Inline prompt text. Wins over \`PROMPT_FILE\` when both are set. |
| \`PROMPT_FILE\` | one of \`PROMPT\` / \`PROMPT_FILE\` | — | Path to a prompt template. If relative, resolved against \`KIRI_REPO_ROOT\`; absolute paths are passed through as-is. |
| \`MAX_TURNS\` | no | \`8\` | Hard cap on the number of agent turns. |
| \`MODEL\` | no | — | Override the model. If unset, \`claude\` picks its default. |

\`KIRI_REPO_ROOT\` is supplied by kiri.

### Precedence

When both \`PROMPT\` and \`PROMPT_FILE\` are set, \`PROMPT\` wins and
\`PROMPT_FILE\` is ignored — its content is not read, validated, or
concatenated. If neither is set, the bundle fails fast with a clear
error before invoking \`claude\`.

## Tool permissions

This bundle does not configure tool permissions — the agent runs with
whatever your \`~/.claude/settings.json\` allows. Constrain a workflow
by writing the prompt around the tools you want it to use, or set up
your global claude settings to match the strictness you want.

## What \`run.sh\` does

1. Reads the previous step's stdout (piped here by kiri) into
   \`KIRI_INPUT\` and renders the prompt text — sourced from \`PROMPT\`
   if set, otherwise from \`$KIRI_REPO_ROOT/$PROMPT_FILE\` — substituting
   \`{{VAR}}\` placeholders from the environment (see *Prompt templates*
   below).
2. Spawns \`claude -p "$prompt" --max-turns "$MAX_TURNS"\` (plus
   \`--model "$MODEL"\` if set). The agent's final message lands on
   stdout and shows up in the run feed.

## Prompt templates

\`{{VAR}}\` placeholders are substituted from the environment in a single
left-to-right pass. The same rules apply whether the prompt came from
\`PROMPT\` or \`PROMPT_FILE\`. Names must be uppercase letters, digits, or
underscores (matching the env-var convention). Unknown vars resolve to
empty. Substituted values are not re-scanned, so a value that itself
contains \`{{X}}\` stays literal — no infinite loops on self-referential
content.

### Substitutable vars

| Var | Source |
| --- | --- |
| \`{{KIRI_INPUT}}\` | Previous step's stdout (one trailing newline trimmed). |
| \`{{KIRI_RUN_ID}}\` | Kiri-injected run identifier. |
| \`{{KIRI_STEP_INDEX}}\` | Zero-based index of this step in the run. |
| \`{{KIRI_REPO_ROOT}}\` | Absolute path of the workflow repo root. |
| \`{{KIRI_BUNDLE_DIR}}\` | Absolute path of this bundle's directory. |
| \`{{MAX_TURNS}}\` | Bundle env-var contract value, defaulted as documented above. |
| \`{{PROMPT}}\`, \`{{PROMPT_FILE}}\`, \`{{MODEL}}\` | Bundle env-var contract values — resolve to empty when unset, since none have a default. |
| Any \`{{MY_VAR}}\` | Anything set in the workflow's \`env:\` block. |

### Example

\`\`\`yaml
- sh: echo "Lee"
- use: claude-code
  env:
    PROMPT_FILE: prompts/greet.tpl
    TONE: cheerful
\`\`\`

\`\`\`
# prompts/greet.tpl
Say a {{TONE}} one-sentence hello to {{KIRI_INPUT}}.
\`\`\`

Renders to: \`Say a cheerful one-sentence hello to Lee.\`

## Dependencies

The \`claude\` CLI must be on \`PATH\` (\`awk\` and POSIX \`sh\` are
assumed). The bundle fails with a clear error at the top of the run if
either is missing.
`;

/** Contents of the scaffolded `scripts/claude-code-summarizer/run.sh`. */
export const CLAUDE_CODE_SUMMARIZER_RUN_SCRIPT = `#!/bin/sh
# Summarises a kiri workflow run for the activity feed. Spawns Claude
# Code with a prompt taken from PROMPT (inline), PROMPT_FILE (a template
# path resolved against KIRI_REPO_ROOT), or a baked-in default that
# points Claude at the run-context JSON file so it reads the envelope
# via its Read tool rather than receiving it inline. When both PROMPT
# and PROMPT_FILE are set, PROMPT wins and PROMPT_FILE is ignored.
# Spawned by kiri after the workflow's \`steps:\` complete on non-
# cancelled runs; this bundle's stdout becomes the run's \`summary\`
# field when it exits 0.
set -eu

: "\${KIRI_REPO_ROOT:?required (kiri injects this)}"
: "\${KIRI_RUN_CONTEXT_FILE:?required (kiri injects this)}"

# Defaults exported so {{MAX_TURNS}} and {{MODEL}} can be referenced
# inside prompt templates even when the workflow leaves them unset.
# MAX_TURNS defaults to 3: one turn for Claude to Read the envelope,
# one to write the summary, plus headroom for a follow-up Read or
# Grep on a large artefact or step stdout.
export MAX_TURNS="\${MAX_TURNS:-3}"
export MODEL="\${MODEL:-haiku}"

for dep in claude awk; do
  command -v "$dep" >/dev/null 2>&1 || {
    echo "claude-code-summarizer bundle requires '$dep' on PATH" >&2
    exit 1
  }
done

[ -f "$KIRI_RUN_CONTEXT_FILE" ] || {
  echo "claude-code-summarizer: run-context file not found: $KIRI_RUN_CONTEXT_FILE" >&2
  exit 1
}

# Resolve the prompt source. PROMPT wins over PROMPT_FILE when both
# are set; both fall through to a baked-in default that hands Claude
# the path to the run-context JSON and asks it to Read the file.
# Inlining the envelope into the prompt argv was the previous default,
# but it scaled poorly: a workflow whose steps produce hundreds of KB
# of stdout (e.g. an org-wide GitHub search) would push the prompt
# past macOS ARG_MAX or the model's input limit. Reading the file
# agentically keeps the prompt small regardless of run size. Verify
# PROMPT_FILE exists *before* the awk render — POSIX \`set -e\` doesn't
# propagate failures from \`$()\` inside an assignment, so a missing
# file would otherwise silently leave \$prompt empty and we'd exec
# \`claude -p ""\`.
if [ -n "\${PROMPT:-}" ]; then
  prompt_source="$PROMPT"
elif [ -n "\${PROMPT_FILE:-}" ]; then
  [ -f "$KIRI_REPO_ROOT/$PROMPT_FILE" ] || {
    echo "claude-code-summarizer: prompt file not found: $PROMPT_FILE" >&2
    exit 1
  }
  prompt_source=$(cat "$KIRI_REPO_ROOT/$PROMPT_FILE")
else
  prompt_source="You are writing a kiri workflow run summary for an activity feed. Lead with what happened — no preamble like 'the workflow ran', no padding. Markdown is supported and encouraged.

Match the shape of the output to the shape of the result:
- If the workflow produced a list of items (for example, 'list all open PRs I need to review'), output a markdown bullet list. Each bullet is one concrete item the reader can skim — label or title first, the smallest useful detail after.
- If the workflow produced a single piece of news, output a single sentence or short paragraph.
- Use bold, inline code, and links where they help the reader scan.

The feed is glanced at, not read. Keep it dense and skimmable, with no headings.

The full run envelope is a JSON file at:
{{KIRI_RUN_CONTEXT_FILE}}

Read it with the Read tool. It contains a steps array (each with stdout and stderr) and an artefacts array (each with markdown content). Skim what the workflow actually produced and write the summary from that. If a step's stdout is very large, use Grep or read only the head — don't try to load megabytes wholesale."
fi

# Slurp stdin so prompts can reference {{KIRI_INPUT}}. Kiri pipes nothing
# into the summariser today, but mirror the claude-code bundle so a
# user-supplied prompt that references {{KIRI_INPUT}} renders to empty
# instead of leaving the placeholder literal.
export KIRI_INPUT="$(cat)"

# Render {{VAR}} placeholders from the environment in a single
# left-to-right pass. Substituted values are not re-scanned, so a
# value containing "{{X}}" stays literal — no infinite loops on
# self-referential content. Unknown vars resolve to empty. LC_ALL=C
# pins the regex character classes to ASCII so non-C locales can't
# widen \`[A-Z]\` to accented uppercase.
prompt=$(printf '%s\\n' "$prompt_source" | LC_ALL=C awk '
  {
    out = ""
    rest = $0
    while (match(rest, /\\{\\{[A-Z_][A-Z0-9_]*\\}\\}/)) {
      name = substr(rest, RSTART + 2, RLENGTH - 4)
      out = out substr(rest, 1, RSTART - 1) ENVIRON[name]
      rest = substr(rest, RSTART + RLENGTH)
    }
    print out rest
  }
')

exec claude -p "$prompt" --max-turns "$MAX_TURNS" --model "$MODEL"
`;

/** Contents of the scaffolded `scripts/claude-code-summarizer/README.md`. */
export const CLAUDE_CODE_SUMMARIZER_README = `# claude-code-summarizer bundle

A workflow \`summarize:\` step that produces a markdown summary of a
run for the activity feed. Spawned by kiri after the workflow's
\`steps:\` complete on non-cancelled runs; this bundle's stdout becomes
the run's \`summary\` when it exits successfully. The feed renders the
result through the SPA's sandboxed markdown component, so the
baked-in prompt produces a single sentence for one-shot results and a
bullet list for list-style results.

## Usage

Reference it from a workflow's \`summarize:\` field — no env vars
needed:

\`\`\`yaml
name: my-workflow
steps:
  - sh: echo "hello"
summarize:
  use: claude-code-summarizer
\`\`\`

Or override the prompt, model, or turn budget directly from the
workflow YAML:

\`\`\`yaml
summarize:
  use: claude-code-summarizer
  env:
    PROMPT: "One witty sentence about this run. Context lives at {{KIRI_RUN_CONTEXT_FILE}}."
    MODEL: sonnet
\`\`\`

Full reference, all knobs explicit:

\`\`\`yaml
summarize:
  use: claude-code-summarizer
  env:
    PROMPT: "Inline prompt text."        # optional; wins over PROMPT_FILE
    PROMPT_FILE: prompts/my-summary.tpl  # optional
    MODEL: sonnet                        # optional, default haiku
    MAX_TURNS: "3"                       # optional, default 3
\`\`\`

## Env-var contract

| Var | Required | Default | Description |
| --- | --- | --- | --- |
| \`PROMPT\` | no | baked-in summariser prompt | Inline prompt text. Wins over \`PROMPT_FILE\` when both are set. |
| \`PROMPT_FILE\` | no | baked-in summariser prompt | Path to a prompt template. If relative, resolved against \`KIRI_REPO_ROOT\`; absolute paths are passed through as-is. |
| \`MODEL\` | no | \`haiku\` | Passed via \`--model\`. |
| \`MAX_TURNS\` | no | \`3\` | Passed via \`--max-turns\`. Default leaves room for one Read of the envelope, the summary turn, and a follow-up Read or Grep on a large artefact. |

\`KIRI_REPO_ROOT\` and \`KIRI_RUN_CONTEXT_FILE\` are supplied by kiri.

### Precedence

When both \`PROMPT\` and \`PROMPT_FILE\` are set, \`PROMPT\` wins and
\`PROMPT_FILE\` is ignored — its content is not read, validated, or
concatenated. When neither is set, the bundle falls back to a baked-in
prompt that points Claude at the run-context JSON path and asks it to
read the envelope via its \`Read\` tool. Matches \`claude-code\`'s
precedence rule.

### Run context

\`KIRI_RUN_CONTEXT_FILE\` points at a JSON file under the per-run scratch
dir containing the workflow name, status, duration, per-step
kind / status / duration / stdout / stderr / error, and the published
artefacts. The baked-in default hands Claude the path (via the
\`{{KIRI_RUN_CONTEXT_FILE}}\` placeholder) and lets it \`Read\` the file
agentically — the envelope is never inlined into the prompt argv, so
runs that produce hundreds of KB of stdout don't push the prompt past
macOS \`ARG_MAX\` or the model's input limit. A user-supplied \`PROMPT\`
or \`PROMPT_FILE\` replaces the *framing* only — if you want the
envelope in your prompt, reference \`{{KIRI_RUN_CONTEXT_FILE}}\` to get
the path and tell Claude (or your own bundle) what to do with it.

## Zero config by design

Zero config is the default posture: a workflow declaring
\`summarize: { use: claude-code-summarizer }\` with no env vars uses
the baked-in prompt, model (\`haiku\`), and turn budget (\`3\`). The
prompt asks Claude to read the envelope, then write a single sentence
when the run produced one piece of news or a markdown bullet list
when it produced a list of items. The env vars above are escape
hatches for workflows that want to shape the summary without forking
the bundle.

If the env-var contract still isn't enough — for example you need
custom dep handling or a different CLI entirely — fork the bundle:

\`\`\`
cp -r scripts/claude-code-summarizer scripts/my-summarizer
$EDITOR scripts/my-summarizer/run.sh
\`\`\`

Then reference your fork:

\`\`\`yaml
summarize:
  use: my-summarizer
\`\`\`

## Prompt templates

\`{{VAR}}\` placeholders are substituted from the environment in a single
left-to-right pass. The same rules apply to whichever source produced
the prompt (\`PROMPT\`, \`PROMPT_FILE\`, or the baked-in default). Names
must be uppercase letters, digits, or underscores. Unknown vars resolve
to empty. Substituted values are not re-scanned, so a value that
itself contains \`{{X}}\` stays literal — no infinite loops on
self-referential content.

### Substitutable vars

| Var | Source |
| --- | --- |
| \`{{KIRI_RUN_CONTEXT_FILE}}\` | Path to the run-envelope JSON file. |
| \`{{KIRI_RUN_ID}}\` | Kiri-injected run identifier. |
| \`{{KIRI_STEP_INDEX}}\` | Zero-based index of this step in the run. |
| \`{{KIRI_REPO_ROOT}}\` | Absolute path of the workflow repo root. |
| \`{{KIRI_BUNDLE_DIR}}\` | Absolute path of this bundle's directory. |
| \`{{KIRI_INPUT}}\` | Stdin piped in by kiri — empty for \`summarize:\` steps today. |
| \`{{MAX_TURNS}}\`, \`{{MODEL}}\` | Bundle env-var contract values, defaulted as documented above. |
| \`{{PROMPT}}\`, \`{{PROMPT_FILE}}\` | Bundle env-var contract values — resolve to empty when unset. |
| Any \`{{MY_VAR}}\` | Anything set in the step's \`env:\` block. |

### Example

\`\`\`yaml
summarize:
  use: claude-code-summarizer
  env:
    PROMPT: "Read {{KIRI_RUN_CONTEXT_FILE}} and write one sentence in a {{TONE}} tone."
    TONE: dry
\`\`\`

## Failure handling

A summariser failure does not affect the run's status — \`runs.status\`
stays \`ok\` or \`failed\` as determined by the workflow steps. The run's
\`summary\` field stays null when the summariser fails. The summariser's
stdout/stderr are captured on a \`run_steps\` row (with \`is_summary\`
set) so the run detail page can surface them for debugging.

## Dependencies

The \`claude\` CLI must be on \`PATH\` (\`awk\` and POSIX \`sh\` are assumed).
The bundle exits non-zero with a clear error if either is missing.
`;

/** Contents of the scaffolded `scripts/lm-studio/run.sh`. */
export const LM_STUDIO_RUN_SCRIPT = `#!/bin/sh
# Sends a one-shot chat completion to LM Studio's OpenAI-compatible HTTP
# server (default http://localhost:1234/v1). The prompt is taken from
# PROMPT (inline) or PROMPT_FILE (a template path resolved against
# KIRI_REPO_ROOT), rendered with {{VAR}} placeholders substituted from
# the environment. When both are set, PROMPT wins and PROMPT_FILE is
# ignored. Non-streaming, no tool use — single completion in, message
# content out. Point BASE_URL at any OpenAI-compatible local server
# (Ollama's compat shim, llama.cpp, vLLM, …) to repurpose the bundle.
set -eu

: "\${KIRI_REPO_ROOT:?required (kiri injects this)}"

# Defaults exported so {{BASE_URL}} and {{MAX_TOKENS}} can be referenced
# inside prompt templates even when the workflow leaves them unset.
export BASE_URL="\${BASE_URL:-http://localhost:1234/v1}"
export MAX_TOKENS="\${MAX_TOKENS:-2048}"

for dep in curl jq awk; do
  command -v "$dep" >/dev/null 2>&1 || {
    echo "lm-studio bundle requires '$dep' on PATH" >&2
    exit 1
  }
done

# Resolve the prompt source. PROMPT wins over PROMPT_FILE when both
# are set. Verify the file exists *before* the awk render — POSIX
# \`set -e\` doesn't propagate failures from \`$()\` inside an
# assignment, so a missing file would otherwise silently leave
# \$prompt empty and we'd POST an empty completion.
if [ -n "\${PROMPT:-}" ]; then
  prompt_source="$PROMPT"
elif [ -n "\${PROMPT_FILE:-}" ]; then
  [ -f "$KIRI_REPO_ROOT/$PROMPT_FILE" ] || {
    echo "lm-studio: prompt file not found: $PROMPT_FILE" >&2
    exit 1
  }
  prompt_source=$(cat "$KIRI_REPO_ROOT/$PROMPT_FILE")
else
  echo "lm-studio: one of PROMPT or PROMPT_FILE is required" >&2
  exit 1
fi

# Slurp the previous step's stdout (piped here by kiri) into KIRI_INPUT
# so prompts can reference {{KIRI_INPUT}}. $() trims one trailing
# newline so single-line outputs render inline; multi-line outputs
# keep their internal newlines.
export KIRI_INPUT="$(cat)"

# Render {{VAR}} placeholders from the environment in a single
# left-to-right pass. Same renderer as the claude-code bundle so
# prompts are portable between the two. Unknown vars resolve to
# empty. LC_ALL=C pins the regex character classes to ASCII so
# non-C locales can't widen \`[A-Z]\` to accented uppercase.
prompt=$(printf '%s\\n' "$prompt_source" | LC_ALL=C awk '
  {
    out = ""
    rest = $0
    while (match(rest, /\\{\\{[A-Z_][A-Z0-9_]*\\}\\}/)) {
      name = substr(rest, RSTART + 2, RLENGTH - 4)
      out = out substr(rest, 1, RSTART - 1) ENVIRON[name]
      rest = substr(rest, RSTART + RLENGTH)
    }
    print out rest
  }
')

# Build the request body with jq so the prompt is escaped correctly
# regardless of quotes / newlines / backslashes in the text. MODEL
# and TEMPERATURE are omitted from the body when unset, so the server
# uses whichever model is currently loaded and its own sampling
# default.
body=$(jq -nc \\
  --arg prompt "$prompt" \\
  --arg model "\${MODEL:-}" \\
  --arg temperature "\${TEMPERATURE:-}" \\
  --argjson max_tokens "$MAX_TOKENS" \\
  '{
    messages: [{ role: "user", content: $prompt }],
    max_tokens: $max_tokens,
    stream: false
  }
  + (if $model == "" then {} else { model: $model } end)
  + (if $temperature == "" then {} else { temperature: ($temperature | tonumber) } end)')

# \`--fail-with-body\` (curl 7.76+) keeps the response body on HTTP
# errors so the caller can see what the server actually said. Without
# it, 4xx/5xx bodies are dropped on the floor and debugging is guesswork.
response=$(curl -sS --fail-with-body \\
  -H "Content-Type: application/json" \\
  -d "$body" \\
  "$BASE_URL/chat/completions") || {
  echo "lm-studio: request to $BASE_URL/chat/completions failed" >&2
  [ -n "\${response:-}" ] && echo "$response" >&2
  exit 1
}

# Extract the assistant's message content. Fail if missing — every
# OpenAI-compatible server returns choices[0].message.content on a
# non-streaming completion.
content=$(printf '%s' "$response" | jq -r '.choices[0].message.content // empty')
if [ -z "$content" ]; then
  echo "lm-studio: response did not contain choices[0].message.content" >&2
  echo "$response" >&2
  exit 1
fi

printf '%s\\n' "$content"
`;

/** Contents of the scaffolded `scripts/lm-studio/README.md`. */
export const LM_STUDIO_README = `# lm-studio bundle

A workflow step that sends a one-shot chat completion to a local
LM Studio server (or any OpenAI-compatible HTTP endpoint). Prompt is
rendered from an inline string (\`PROMPT\`) or a template file
(\`PROMPT_FILE\`). Exactly one is required.

Minimal usage — inline prompt:

\`\`\`yaml
- use: lm-studio
  env:
    PROMPT: "Summarise {{KIRI_INPUT}} in one sentence."
\`\`\`

Or from a template file:

\`\`\`yaml
- use: lm-studio
  env:
    PROMPT_FILE: prompts/my-prompt.tpl
\`\`\`

Full reference, all knobs explicit:

\`\`\`yaml
- use: lm-studio
  env:
    PROMPT: "Inline prompt text."          # one of PROMPT / PROMPT_FILE required
    PROMPT_FILE: prompts/my-prompt.tpl     # one of PROMPT / PROMPT_FILE required
    MODEL: gemma-3-12b                     # optional, server uses loaded model when unset
    BASE_URL: http://localhost:1234/v1     # optional, default LM Studio HTTP server
    MAX_TOKENS: "2048"                     # optional, default 2048
    TEMPERATURE: "0.7"                     # optional, server default applies when unset
\`\`\`

## Env-var contract

| Var | Required | Default | Description |
| --- | --- | --- | --- |
| \`PROMPT\` | one of \`PROMPT\` / \`PROMPT_FILE\` | — | Inline prompt text. Wins over \`PROMPT_FILE\` when both are set. |
| \`PROMPT_FILE\` | one of \`PROMPT\` / \`PROMPT_FILE\` | — | Path to a prompt template. If relative, resolved against \`KIRI_REPO_ROOT\`; absolute paths are passed through as-is. |
| \`MODEL\` | no | — | Model identifier. Omitted from the request when unset; the server uses whichever model is currently loaded. |
| \`BASE_URL\` | no | \`http://localhost:1234/v1\` | OpenAI-compatible API root. Point this at Ollama's compat shim, llama.cpp's server, vLLM, etc. to repurpose the bundle. |
| \`MAX_TOKENS\` | no | \`2048\` | Hard cap on the completion length. |
| \`TEMPERATURE\` | no | — | Sampling temperature. Omitted from the request when unset, so the server's own default applies. |

\`KIRI_REPO_ROOT\` is supplied by kiri.

### Precedence

When both \`PROMPT\` and \`PROMPT_FILE\` are set, \`PROMPT\` wins and
\`PROMPT_FILE\` is ignored — its content is not read, validated, or
concatenated. Mirrors \`claude-code\`'s precedence rule.

## What \`run.sh\` does

1. Reads the previous step's stdout into \`KIRI_INPUT\` and renders the
   prompt — sourced from \`PROMPT\` or \`$KIRI_REPO_ROOT/$PROMPT_FILE\` —
   substituting \`{{VAR}}\` placeholders from the environment (see
   *Prompt templates* below).
2. Builds the JSON request body via \`jq\`, so the prompt is escaped
   correctly regardless of quotes, newlines, or backslashes.
3. POSTs to \`$BASE_URL/chat/completions\` with \`curl --fail-with-body\`,
   extracts \`choices[0].message.content\`, and prints it on stdout.

Non-streaming, no tool use, single completion in, text out.

## Prompt templates

Same renderer as \`claude-code\` — prompts written for one bundle work
in the other. \`{{VAR}}\` placeholders are substituted from the
environment in a single left-to-right pass. Names must be uppercase
letters, digits, or underscores. Unknown vars resolve to empty.
Substituted values are not re-scanned, so a value containing
\`{{X}}\` stays literal — no infinite loops on self-referential content.

### Substitutable vars

| Var | Source |
| --- | --- |
| \`{{KIRI_INPUT}}\` | Previous step's stdout (one trailing newline trimmed). |
| \`{{KIRI_RUN_ID}}\` | Kiri-injected run identifier. |
| \`{{KIRI_STEP_INDEX}}\` | Zero-based index of this step in the run. |
| \`{{KIRI_REPO_ROOT}}\` | Absolute path of the workflow repo root. |
| \`{{KIRI_BUNDLE_DIR}}\` | Absolute path of this bundle's directory. |
| \`{{BASE_URL}}\`, \`{{MAX_TOKENS}}\` | Bundle env-var contract values, defaulted as documented above. |
| \`{{MODEL}}\`, \`{{TEMPERATURE}}\`, \`{{PROMPT}}\`, \`{{PROMPT_FILE}}\` | Bundle env-var contract values — resolve to empty when unset. |
| Any \`{{MY_VAR}}\` | Anything set in the workflow's \`env:\` block. |

## Example: local triage in front of a cloud agent

The intended use shape — a cheap local model filters input so the
cloud step only runs on the survivors:

\`\`\`yaml
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
\`\`\`

Local handles "is this worth my attention"; cloud only runs on what
survived the filter.

## Dependencies

\`curl\`, \`jq\`, and POSIX \`awk\` must be on \`PATH\`. The bundle exits
non-zero with a clear error at the top of the run if any are missing.
\`curl\` must be ≥ 7.76 (for \`--fail-with-body\`); macOS 12+ and recent
Linux distros all qualify.

LM Studio's HTTP server must be running and reachable at \`BASE_URL\`.
In LM Studio: Developer tab → Server → Start Server. The default
\`http://localhost:1234/v1\` matches LM Studio's defaults.
`;

/** Contents of the scaffolded `scripts/lm-studio-summarizer/run.sh`. */
export const LM_STUDIO_SUMMARIZER_RUN_SCRIPT = `#!/bin/sh
# Summarises a kiri workflow run for the activity feed via LM Studio's
# OpenAI-compatible HTTP server (default http://localhost:1234/v1).
# Prompt is taken from PROMPT (inline), PROMPT_FILE (a template path
# resolved against KIRI_REPO_ROOT), or a baked-in default that inlines
# the run-context JSON. When both PROMPT and PROMPT_FILE are set,
# PROMPT wins and PROMPT_FILE is ignored. Spawned by kiri after the
# workflow's \`steps:\` complete on non-cancelled runs; this bundle's
# stdout becomes the run's \`summary\` field when it exits 0. Point
# BASE_URL at any OpenAI-compatible local server to repurpose the
# bundle.
set -eu

: "\${KIRI_REPO_ROOT:?required (kiri injects this)}"
: "\${KIRI_RUN_CONTEXT_FILE:?required (kiri injects this)}"

# Defaults exported so {{BASE_URL}} and {{MAX_TOKENS}} can be referenced
# inside prompt templates even when the workflow leaves them unset.
export BASE_URL="\${BASE_URL:-http://localhost:1234/v1}"
export MAX_TOKENS="\${MAX_TOKENS:-2048}"

for dep in curl jq awk; do
  command -v "$dep" >/dev/null 2>&1 || {
    echo "lm-studio-summarizer bundle requires '$dep' on PATH" >&2
    exit 1
  }
done

[ -f "$KIRI_RUN_CONTEXT_FILE" ] || {
  echo "lm-studio-summarizer: run-context file not found: $KIRI_RUN_CONTEXT_FILE" >&2
  exit 1
}

# Read the run-context content once and export it so prompt templates
# can reference {{KIRI_RUN_CONTEXT}} via the awk substitution pass.
# Non-tool-using models can't open the path in KIRI_RUN_CONTEXT_FILE on
# their own; inlining the content into the prompt is the deterministic
# alternative to an agentic loop.
export KIRI_RUN_CONTEXT="$(cat "$KIRI_RUN_CONTEXT_FILE")"

# Resolve the prompt source. PROMPT wins over PROMPT_FILE when both are
# set; both fall through to a baked-in default that inlines the
# run-context JSON so a workflow with no env vars produces a useful
# summary out of the box. Verify the file exists *before* the awk
# render — POSIX \`set -e\` doesn't propagate failures from \`$()\` inside
# an assignment, so a missing file would otherwise silently leave
# \$prompt empty and we'd POST an empty completion.
if [ -n "\${PROMPT:-}" ]; then
  prompt_source="$PROMPT"
elif [ -n "\${PROMPT_FILE:-}" ]; then
  [ -f "$KIRI_REPO_ROOT/$PROMPT_FILE" ] || {
    echo "lm-studio-summarizer: prompt file not found: $PROMPT_FILE" >&2
    exit 1
  }
  prompt_source=$(cat "$KIRI_REPO_ROOT/$PROMPT_FILE")
else
  prompt_source="You are writing a kiri workflow run summary for an activity feed. Read the step stdout/stderr to find the substance and lead with what happened — no preamble like 'the workflow ran', no padding. Markdown is supported and encouraged.

Match the shape of the output to the shape of the result:
- If the workflow produced a list of items (for example, 'list all open PRs I need to review'), output a markdown bullet list. Each bullet is one concrete item the reader can skim — label or title first, the smallest useful detail after.
- If the workflow produced a single piece of news, output a single sentence or short paragraph.
- Use bold, inline code, and links where they help the reader scan.

The feed is glanced at, not read. Keep it dense and skimmable, with no headings.

Run envelope (JSON):
\$KIRI_RUN_CONTEXT"
fi

# Slurp stdin so prompts can reference {{KIRI_INPUT}}. Kiri pipes
# nothing into the summariser today, but mirror the lm-studio bundle so
# a user-supplied prompt that references {{KIRI_INPUT}} renders to
# empty instead of leaving the placeholder literal.
export KIRI_INPUT="$(cat)"

# Render {{VAR}} placeholders from the environment in a single
# left-to-right pass. Same renderer as the lm-studio bundle so prompts
# are portable between the two. Unknown vars resolve to empty. LC_ALL=C
# pins the regex character classes to ASCII so non-C locales can't
# widen \`[A-Z]\` to accented uppercase.
prompt=$(printf '%s\\n' "$prompt_source" | LC_ALL=C awk '
  {
    out = ""
    rest = $0
    while (match(rest, /\\{\\{[A-Z_][A-Z0-9_]*\\}\\}/)) {
      name = substr(rest, RSTART + 2, RLENGTH - 4)
      out = out substr(rest, 1, RSTART - 1) ENVIRON[name]
      rest = substr(rest, RSTART + RLENGTH)
    }
    print out rest
  }
')

# Build the request body with jq so the prompt is escaped correctly
# regardless of quotes / newlines / backslashes in the text. MODEL is
# omitted from the body when unset, so the server uses whichever model
# is currently loaded.
body=$(jq -nc \\
  --arg prompt "$prompt" \\
  --arg model "\${MODEL:-}" \\
  --argjson max_tokens "$MAX_TOKENS" \\
  '{
    messages: [{ role: "user", content: $prompt }],
    max_tokens: $max_tokens,
    stream: false
  }
  + (if $model == "" then {} else { model: $model } end)')

# \`--fail-with-body\` (curl 7.76+) keeps the response body on HTTP
# errors so the caller can see what the server actually said.
response=$(curl -sS --fail-with-body \\
  -H "Content-Type: application/json" \\
  -d "$body" \\
  "$BASE_URL/chat/completions") || {
  echo "lm-studio-summarizer: request to $BASE_URL/chat/completions failed" >&2
  [ -n "\${response:-}" ] && echo "$response" >&2
  exit 1
}

content=$(printf '%s' "$response" | jq -r '.choices[0].message.content // empty')
if [ -z "$content" ]; then
  echo "lm-studio-summarizer: response did not contain choices[0].message.content" >&2
  echo "$response" >&2
  exit 1
fi

printf '%s\\n' "$content"
`;

/** Contents of the scaffolded `scripts/lm-studio-summarizer/README.md`. */
export const LM_STUDIO_SUMMARIZER_README = `# lm-studio-summarizer bundle

A workflow \`summarize:\` step that produces a markdown summary of a run
for the activity feed, using a local LM Studio server (or any
OpenAI-compatible HTTP endpoint). Spawned by kiri after the workflow's
\`steps:\` complete on non-cancelled runs; this bundle's stdout becomes
the run's \`summary\` when it exits successfully. The feed renders the
result through the SPA's sandboxed markdown component, so the baked-in
prompt produces a single sentence for one-shot results and a bullet
list for list-style results.

## Usage

Reference it from a workflow's \`summarize:\` field — no env vars
needed:

\`\`\`yaml
name: my-workflow
steps:
  - sh: echo "hello"
summarize:
  use: lm-studio-summarizer
\`\`\`

Or override the prompt, model, base URL, or token cap directly from
the workflow YAML:

\`\`\`yaml
summarize:
  use: lm-studio-summarizer
  env:
    PROMPT: "One witty sentence about this run. Context lives at {{KIRI_RUN_CONTEXT_FILE}}."
    MODEL: gemma-3-12b
\`\`\`

Full reference, all knobs explicit:

\`\`\`yaml
summarize:
  use: lm-studio-summarizer
  env:
    PROMPT: "Inline prompt text."          # optional; wins over PROMPT_FILE
    PROMPT_FILE: prompts/my-summary.tpl    # optional
    MODEL: gemma-3-12b                     # optional, server uses loaded model when unset
    BASE_URL: http://localhost:1234/v1     # optional, default LM Studio HTTP server
    MAX_TOKENS: "2048"                     # optional, default 2048
\`\`\`

## Env-var contract

| Var | Required | Default | Description |
| --- | --- | --- | --- |
| \`PROMPT\` | no | baked-in summariser prompt | Inline prompt text. Wins over \`PROMPT_FILE\` when both are set. |
| \`PROMPT_FILE\` | no | baked-in summariser prompt | Path to a prompt template. If relative, resolved against \`KIRI_REPO_ROOT\`; absolute paths are passed through as-is. |
| \`MODEL\` | no | — | Model identifier. Omitted from the request when unset; the server uses whichever model is currently loaded. |
| \`BASE_URL\` | no | \`http://localhost:1234/v1\` | OpenAI-compatible API root. Point this at Ollama's compat shim, llama.cpp's server, vLLM, etc. to repurpose the bundle. |
| \`MAX_TOKENS\` | no | \`2048\` | Hard cap on the summary length. |

\`KIRI_REPO_ROOT\` and \`KIRI_RUN_CONTEXT_FILE\` are supplied by kiri.

### Precedence

When both \`PROMPT\` and \`PROMPT_FILE\` are set, \`PROMPT\` wins and
\`PROMPT_FILE\` is ignored — its content is not read, validated, or
concatenated. When neither is set, the bundle falls back to a baked-in
prompt that inlines the run-context JSON. Matches \`claude-code-summarizer\`'s
precedence rule.

### Run context

\`KIRI_RUN_CONTEXT_FILE\` points at a JSON file under the per-run scratch
dir containing the workflow name, status, duration, and per-step
kind / status / duration / stdout / stderr / error. The bundle reads
that file at the top of \`run.sh\` and exposes its content as
\`{{KIRI_RUN_CONTEXT}}\` for the prompt-template substitution pass.

A user-supplied \`PROMPT\` or \`PROMPT_FILE\` replaces the *framing* only.
To bring the envelope content into a custom prompt, reference
\`{{KIRI_RUN_CONTEXT}}\` directly — this is the deterministic path for
non-agentic local models, which can't open files on their own. The
older \`{{KIRI_RUN_CONTEXT_FILE}}\` (just the path) remains available
for agentic bundles where the model can call a \`read_file\` tool.

## Zero config by design

Zero config is the default posture: a workflow declaring
\`summarize: { use: lm-studio-summarizer }\` with no env vars uses the
baked-in prompt and posts to the default LM Studio endpoint with
whichever model is currently loaded. The prompt asks for a single
sentence when the run produced one piece of news and a markdown bullet
list when it produced a list of items. The env vars above are escape
hatches for workflows that want to shape the summary without forking
the bundle.

If the env-var contract still isn't enough — for example you need
custom dep handling or a different CLI entirely — fork the bundle:

\`\`\`
cp -r scripts/lm-studio-summarizer scripts/my-summarizer
$EDITOR scripts/my-summarizer/run.sh
\`\`\`

Then reference your fork:

\`\`\`yaml
summarize:
  use: my-summarizer
\`\`\`

## Prompt templates

Same renderer as \`lm-studio\` and \`claude-code\` — prompts are portable
across all three bundles. \`{{VAR}}\` placeholders are substituted from
the environment in a single left-to-right pass. The same rules apply
to whichever source produced the prompt (\`PROMPT\`, \`PROMPT_FILE\`, or
the baked-in default). Names must be uppercase letters, digits, or
underscores. Unknown vars resolve to empty. Substituted values are
not re-scanned, so a value that itself contains \`{{X}}\` stays literal
— no infinite loops on self-referential content.

### Substitutable vars

| Var | Source |
| --- | --- |
| \`{{KIRI_RUN_CONTEXT}}\` | The run-envelope JSON content, inlined verbatim. Use this when the model can't open files itself (i.e. any non-agentic local model). |
| \`{{KIRI_RUN_CONTEXT_FILE}}\` | Path to the run-envelope JSON file. Only useful when the model can open files on its own. |
| \`{{KIRI_RUN_ID}}\` | Kiri-injected run identifier. |
| \`{{KIRI_STEP_INDEX}}\` | Zero-based index of this step in the run. |
| \`{{KIRI_REPO_ROOT}}\` | Absolute path of the workflow repo root. |
| \`{{KIRI_BUNDLE_DIR}}\` | Absolute path of this bundle's directory. |
| \`{{KIRI_INPUT}}\` | Stdin piped in by kiri — empty for \`summarize:\` steps today. |
| \`{{BASE_URL}}\`, \`{{MAX_TOKENS}}\` | Bundle env-var contract values, defaulted as documented above. |
| \`{{MODEL}}\`, \`{{PROMPT}}\`, \`{{PROMPT_FILE}}\` | Bundle env-var contract values — resolve to empty when unset. |
| Any \`{{MY_VAR}}\` | Anything set in the step's \`env:\` block. |

### Example

\`\`\`yaml
summarize:
  use: lm-studio-summarizer
  env:
    PROMPT: "Read {{KIRI_RUN_CONTEXT_FILE}} and write one sentence in a {{TONE}} tone."
    TONE: dry
\`\`\`

## Failure handling

A summariser failure does not affect the run's status — \`runs.status\`
stays \`ok\` or \`failed\` as determined by the workflow steps. The run's
\`summary\` field stays null when the summariser fails. The summariser's
stdout/stderr are captured on a \`run_steps\` row (with \`is_summary\`
set) so the run detail page can surface them for debugging.

## Dependencies

\`curl\`, \`jq\`, and POSIX \`awk\` must be on \`PATH\`. The bundle exits
non-zero with a clear error at the top of the run if any are missing.
\`curl\` must be ≥ 7.76 (for \`--fail-with-body\`); macOS 12+ and recent
Linux distros all qualify.

LM Studio's HTTP server must be running and reachable at \`BASE_URL\`.
In LM Studio: Developer tab → Server → Start Server. The default
\`http://localhost:1234/v1\` matches LM Studio's defaults.
`;

/** Contents of the scaffolded `workflows/daily-briefing.yaml`. */
export const DAILY_BRIEFING_WORKFLOW = `# yaml-language-server: $schema=../.kiri/workflow.schema.json

name: Daily Briefing
steps:
  - sh: |
      set -eu
      for dep in curl jq; do
        command -v "$dep" >/dev/null 2>&1 || {
          echo "daily-briefing requires '$dep' on PATH" >&2
          exit 1
        }
      done

      hn_limit=30
      hn_ids=$(curl -fsSL "https://hacker-news.firebaseio.com/v0/beststories.json" \\
        | jq -r ".[:\${hn_limit}][]")

      printf '{"hackernews":['
      first=1
      for id in $hn_ids; do
        [ "$first" = 1 ] && first=0 || printf ','
        curl -fsSL "https://hacker-news.firebaseio.com/v0/item/\${id}.json"
      done
      printf '],"devto":'

      curl -fsSL "https://dev.to/api/articles?per_page=30&top=1"
      printf '}'
    description: Fetch HackerNews best stories and Dev.to top articles

publish:
  - name: briefing
    title: Daily Briefing
    description: Today's most important tech news, with a roundup and a thought to chew on.
    use: claude-code
    env:
      PROMPT_FILE: prompts/daily-briefing.tpl
      MODEL: haiku
      MAX_TURNS: "10"

summarize:
  use: claude-code-summarizer
  env:
    MODEL: haiku
`;

/** Contents of the scaffolded `prompts/daily-briefing.tpl`. */
export const DAILY_BRIEFING_PROMPT = `You are writing a daily tech briefing for a developer who wants to
stay current on big tech news (AI, security, anything a senior
engineer would care about) and on developer news (frontend, JS/TS,
cloud, infra).

The full run envelope is at:
{{KIRI_RUN_CONTEXT_FILE}}

Inside that JSON, \`steps[0].stdout\` is a single JSON object with two fields:
- \`hackernews\`: an array of HackerNews items. Each has \`title\`, \`url\`, \`score\`,
  \`by\`, \`descendants\` (comment count), \`type\` (story, job, poll, …).
- \`devto\`: an array of Dev.to articles. Each has \`title\`, \`url\`, \`description\`,
  \`tag_list\`, \`positive_reactions_count\`, \`user.name\`, \`published_at\`.

Read those, then write a tight markdown briefing with exactly this structure
and these headings, no preamble, no sign-off:

## Today

One or two short paragraphs about the single most important story (or two
if there are genuinely two distinct big stories). Pick what a thoughtful
principal engineer would care about most — significance over virality. Link
the primary source inline (the article itself, not the HackerNews comments
page). End each paragraph with one short line on *why this matters* or
*what's interesting* — under fifteen words.

## Worth a scan

A markdown bullet list of 6–10 other notable links, grouped lightly under
bold-prefix categories drawn from: **AI**, **Security**, **JS/TS/Frontend**,
**AWS/Cloud**, **Industry**. Skip any category with nothing today. Each
bullet: title as link, then an em-dash and a 6–12 word note. One bullet per
line. Real titles only — don't invent.

## To ideate on

One short, conversational prompt or open question to chew on today,
rooted in a theme you noticed in the news. Two or three sentences max.
Frame it as something to think about over coffee, not a homework
assignment.

Rules:
- No preamble like "Here's your briefing".
- Skip items that are just hiring threads, "Show HN" toys with no
  substance, product launches with no news, or memes — unless they're
  load-bearing.
- Prefer primary sources. For HackerNews story items, link \`url\` (the
  article); only link the HN discussion page when the discussion is itself
  the news.
- Don't pad. Brevity is the point — the whole briefing should be skimmable
  in under two minutes.
- If a Dev.to article and an HN story cover the same news, prefer whichever
  source is the original or more substantive — don't list both.
`;

/** Relative paths reported by `initRepo`. */
const SCHEMA_REL_PATH = ".kiri/workflow.schema.json";
const README_REL_PATH = "README.md";
const CLAUDE_CODE_RUN_REL_PATH = "scripts/claude-code/run.sh";
const CLAUDE_CODE_README_REL_PATH = "scripts/claude-code/README.md";
const CLAUDE_CODE_SUMMARIZER_RUN_REL_PATH = "scripts/claude-code-summarizer/run.sh";
const CLAUDE_CODE_SUMMARIZER_README_REL_PATH = "scripts/claude-code-summarizer/README.md";
const LM_STUDIO_RUN_REL_PATH = "scripts/lm-studio/run.sh";
const LM_STUDIO_README_REL_PATH = "scripts/lm-studio/README.md";
const LM_STUDIO_SUMMARIZER_RUN_REL_PATH = "scripts/lm-studio-summarizer/run.sh";
const LM_STUDIO_SUMMARIZER_README_REL_PATH = "scripts/lm-studio-summarizer/README.md";
const DAILY_BRIEFING_WORKFLOW_REL_PATH = "workflows/daily-briefing.yaml";
const DAILY_BRIEFING_PROMPT_REL_PATH = "prompts/daily-briefing.tpl";
const GITIGNORE_REL_PATH = ".gitignore";
const GITIGNORE_KIRI_LINE = ".kiri/";

/** Structured summary of what `initRepo` did, suitable for logging by the CLI. */
export interface InitResult {
  /** Repo-relative paths of files newly written. */
  created: string[];
  /** Repo-relative paths of files that already existed and were left untouched. */
  skipped: string[];
  /** Repo-relative path of the schema file (always (re)written). */
  schemaPath: string;
  /** True if `.gitignore` was created or appended to add the `.kiri/` line. */
  gitignoreUpdated: boolean;
}

/**
 * (Re)write `.kiri/workflow.schema.json` from the live Zod schema. Called by
 * both `initRepo` and on every kiri startup so the schema file stays in sync
 * after a binary upgrade — no need to re-run `init` to refresh it.
 */
export function writeSchemaFile(cwd: string): string {
  const dir = join(cwd, ".kiri");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "workflow.schema.json");
  writeFileSync(path, `${JSON.stringify(workflowJsonSchema(), null, 2)}\n`);
  return path;
}

const writeIfMissing = (
  absPath: string,
  relPath: string,
  contents: string,
  created: string[],
  skipped: string[],
  mode?: number,
): void => {
  if (existsSync(absPath)) {
    skipped.push(relPath);
    return;
  }
  writeFileSync(absPath, contents);
  if (mode !== undefined) chmodSync(absPath, mode);
  created.push(relPath);
};

const ensureKiriIgnored = (cwd: string): boolean => {
  const path = join(cwd, GITIGNORE_REL_PATH);
  if (!existsSync(path)) {
    writeFileSync(path, `${GITIGNORE_KIRI_LINE}\n`);
    return true;
  }

  const current = readFileSync(path, "utf8");
  const hasLine = current
    .split("\n")
    .some((line) => line.trim() === ".kiri" || line.trim() === ".kiri/");
  if (hasLine) return false;

  const trailing = current.length === 0 || current.endsWith("\n") ? "" : "\n";
  writeFileSync(path, `${current}${trailing}${GITIGNORE_KIRI_LINE}\n`);
  return true;
};

/**
 * Bootstrap a kiri-ready repo at `cwd`: create `workflows/` and `prompts/`,
 * drop in a repo README, the `claude-code`, `claude-code-summarizer`,
 * `lm-studio`, and `lm-studio-summarizer` bundles, the `daily-briefing`
 * starter workflow and its prompt template, (re)write the JSON Schema
 * file, and add `.kiri/` to `.gitignore` if one exists. User-authored
 * files are never overwritten — only missing files are created. The
 * schema file is always refreshed.
 */
export function initRepo(cwd: string): InitResult {
  const workflowsDir = join(cwd, "workflows");
  const promptsDir = join(cwd, "prompts");
  const claudeCodeBundleDir = join(cwd, "scripts", "claude-code");
  const claudeCodeSummarizerBundleDir = join(cwd, "scripts", "claude-code-summarizer");
  const lmStudioBundleDir = join(cwd, "scripts", "lm-studio");
  const lmStudioSummarizerBundleDir = join(cwd, "scripts", "lm-studio-summarizer");
  mkdirSync(workflowsDir, { recursive: true });
  mkdirSync(promptsDir, { recursive: true });
  mkdirSync(claudeCodeBundleDir, { recursive: true });
  mkdirSync(claudeCodeSummarizerBundleDir, { recursive: true });
  mkdirSync(lmStudioBundleDir, { recursive: true });
  mkdirSync(lmStudioSummarizerBundleDir, { recursive: true });

  const created: string[] = [];
  const skipped: string[] = [];

  writeIfMissing(join(cwd, "README.md"), README_REL_PATH, KIRI_README, created, skipped);
  writeIfMissing(
    join(claudeCodeBundleDir, "run.sh"),
    CLAUDE_CODE_RUN_REL_PATH,
    CLAUDE_CODE_RUN_SCRIPT,
    created,
    skipped,
    0o755,
  );
  writeIfMissing(
    join(claudeCodeBundleDir, "README.md"),
    CLAUDE_CODE_README_REL_PATH,
    CLAUDE_CODE_README,
    created,
    skipped,
  );
  writeIfMissing(
    join(claudeCodeSummarizerBundleDir, "run.sh"),
    CLAUDE_CODE_SUMMARIZER_RUN_REL_PATH,
    CLAUDE_CODE_SUMMARIZER_RUN_SCRIPT,
    created,
    skipped,
    0o755,
  );
  writeIfMissing(
    join(claudeCodeSummarizerBundleDir, "README.md"),
    CLAUDE_CODE_SUMMARIZER_README_REL_PATH,
    CLAUDE_CODE_SUMMARIZER_README,
    created,
    skipped,
  );
  writeIfMissing(
    join(lmStudioBundleDir, "run.sh"),
    LM_STUDIO_RUN_REL_PATH,
    LM_STUDIO_RUN_SCRIPT,
    created,
    skipped,
    0o755,
  );
  writeIfMissing(
    join(lmStudioBundleDir, "README.md"),
    LM_STUDIO_README_REL_PATH,
    LM_STUDIO_README,
    created,
    skipped,
  );
  writeIfMissing(
    join(lmStudioSummarizerBundleDir, "run.sh"),
    LM_STUDIO_SUMMARIZER_RUN_REL_PATH,
    LM_STUDIO_SUMMARIZER_RUN_SCRIPT,
    created,
    skipped,
    0o755,
  );
  writeIfMissing(
    join(lmStudioSummarizerBundleDir, "README.md"),
    LM_STUDIO_SUMMARIZER_README_REL_PATH,
    LM_STUDIO_SUMMARIZER_README,
    created,
    skipped,
  );
  writeIfMissing(
    join(workflowsDir, "daily-briefing.yaml"),
    DAILY_BRIEFING_WORKFLOW_REL_PATH,
    DAILY_BRIEFING_WORKFLOW,
    created,
    skipped,
  );
  writeIfMissing(
    join(promptsDir, "daily-briefing.tpl"),
    DAILY_BRIEFING_PROMPT_REL_PATH,
    DAILY_BRIEFING_PROMPT,
    created,
    skipped,
  );

  writeSchemaFile(cwd);
  const gitignoreUpdated = ensureKiriIgnored(cwd);

  return {
    created,
    skipped,
    schemaPath: SCHEMA_REL_PATH,
    gitignoreUpdated,
  };
}
