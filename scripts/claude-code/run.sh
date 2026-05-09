#!/bin/sh
# Spawns the Claude Code CLI with the prompt read from PROMPT_FILE
# (resolved against KIRI_REPO_ROOT) and rendered with {{VAR}}
# placeholders substituted from the environment. Tool permissions
# are deferred to the user's own ~/.claude/settings.json — keeps
# this bundle out of the credential-resolution path so claude's
# normal login flow keeps working.
set -eu

: "${PROMPT_FILE:?required env var}"
: "${KIRI_REPO_ROOT:?required (kiri injects this)}"

# Default exported so {{MAX_TURNS}} can be referenced inside prompt
# templates even when the workflow leaves it unset.
export MAX_TURNS="${MAX_TURNS:-8}"

for dep in claude awk; do
  command -v "$dep" >/dev/null 2>&1 || {
    echo "claude-code bundle requires '$dep' on PATH" >&2
    exit 1
  }
done

# Verify the prompt file exists *before* the awk render — POSIX
# `set -e` doesn't propagate failures from `$()` inside an
# assignment, so a missing file would otherwise silently leave
# $prompt empty and we'd exec `claude -p ""`.
[ -f "$KIRI_REPO_ROOT/$PROMPT_FILE" ] || {
  echo "claude-code: prompt file not found: $PROMPT_FILE" >&2
  exit 1
}

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
prompt=$(LC_ALL=C awk '
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
' "$KIRI_REPO_ROOT/$PROMPT_FILE")

if [ -n "${MODEL:-}" ]; then
  exec claude -p "$prompt" --max-turns "$MAX_TURNS" --model "$MODEL"
else
  exec claude -p "$prompt" --max-turns "$MAX_TURNS"
fi
