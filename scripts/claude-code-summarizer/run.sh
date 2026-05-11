#!/bin/sh
# Summarises a kiri workflow run for the activity feed. Spawns Claude
# Code with a prompt taken from PROMPT (inline), PROMPT_FILE (a template
# path resolved against KIRI_REPO_ROOT), or a baked-in default that
# inlines the run-context JSON. When both PROMPT and PROMPT_FILE are
# set, PROMPT wins and PROMPT_FILE is ignored. Spawned by kiri after
# the workflow's `steps:` complete on non-cancelled runs; this bundle's
# stdout becomes the run's `summary` field when it exits 0.
set -eu

: "${KIRI_REPO_ROOT:?required (kiri injects this)}"
: "${KIRI_RUN_CONTEXT_FILE:?required (kiri injects this)}"

# Defaults exported so {{MAX_TURNS}} and {{MODEL}} can be referenced
# inside prompt templates even when the workflow leaves them unset.
export MAX_TURNS="${MAX_TURNS:-1}"
export MODEL="${MODEL:-haiku}"

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

# Resolve the prompt source. PROMPT wins over PROMPT_FILE when both are
# set; both fall through to a baked-in default that inlines the
# run-context JSON so a workflow with no env vars produces the same
# prompt as before. Verify the file exists *before* the awk render —
# POSIX `set -e` doesn't propagate failures from `$()` inside an
# assignment, so a missing file would otherwise silently leave
# $prompt empty and we'd exec `claude -p ""`.
if [ -n "${PROMPT:-}" ]; then
  prompt_source="$PROMPT"
elif [ -n "${PROMPT_FILE:-}" ]; then
  [ -f "$KIRI_REPO_ROOT/$PROMPT_FILE" ] || {
    echo "claude-code-summarizer: prompt file not found: $PROMPT_FILE" >&2
    exit 1
  }
  prompt_source=$(cat "$KIRI_REPO_ROOT/$PROMPT_FILE")
else
  context=$(cat "$KIRI_RUN_CONTEXT_FILE")
  prompt_source="You are writing a one or two sentence summary of a kiri workflow run for an activity feed. Lead with what happened — read the step stdout/stderr to find the substance. No markdown, no headers, no bullets, no preamble like 'the workflow ran'. Plain prose, under 40 words.

Run envelope (JSON):
$context"
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
# widen `[A-Z]` to accented uppercase.
prompt=$(printf '%s\n' "$prompt_source" | LC_ALL=C awk '
  {
    out = ""
    rest = $0
    while (match(rest, /\{\{[A-Z_][A-Z0-9_]*\}\}/)) {
      name = substr(rest, RSTART + 2, RLENGTH - 4)
      out = out substr(rest, 1, RSTART - 1) ENVIRON[name]
      rest = substr(rest, RSTART + RLENGTH)
    }
    print out rest
  }
')

exec claude -p "$prompt" --max-turns "$MAX_TURNS" --model "$MODEL"
