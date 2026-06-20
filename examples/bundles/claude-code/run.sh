#!/bin/sh
# Spawns the Claude Code CLI with the prompt taken from PROMPT (inline)
# or PROMPT_FILE (a template path resolved against KIRI_REPO_ROOT),
# rendered with {{VAR}} placeholders substituted from the environment.
# When both are set, PROMPT wins and PROMPT_FILE is ignored. Tool
# permissions are deferred to the user's own ~/.claude/settings.json —
# keeps this bundle out of the credential-resolution path so claude's
# normal login flow keeps working.
set -eu

: "${KIRI_REPO_ROOT:?required (kiri injects this)}"

# Default exported so {{MAX_TURNS}} can be referenced inside prompt
# templates even when the workflow leaves it unset.
export MAX_TURNS="${MAX_TURNS:-50}"

for dep in claude awk; do
  command -v "$dep" >/dev/null 2>&1 || {
    echo "claude-code bundle requires '$dep' on PATH" >&2
    exit 1
  }
done

# Resolve the prompt source. PROMPT wins over PROMPT_FILE when both
# are set. Verify the file exists *before* the awk render — POSIX
# `set -e` doesn't propagate failures from `$()` inside an
# assignment, so a missing file would otherwise silently leave
# $prompt empty and we'd exec `claude -p ""`.
if [ -n "${PROMPT:-}" ]; then
  prompt_source="$PROMPT"
elif [ -n "${PROMPT_FILE:-}" ]; then
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
# newline so single-line outputs (e.g. `echo "Lee"`) render inline;
# multi-line outputs keep their internal newlines.
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

if [ -n "${MODEL:-}" ]; then
  exec claude -p "$prompt" --max-turns "$MAX_TURNS" --model "$MODEL"
else
  exec claude -p "$prompt" --max-turns "$MAX_TURNS"
fi
