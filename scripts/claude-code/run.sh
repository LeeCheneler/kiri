#!/bin/sh
# Spawns the Claude Code CLI with a per-run permission allowlist
# synthesised from ALLOWED_TOOLS. The prompt is read from PROMPT_FILE
# (resolved against KIRI_REPO_ROOT), rendered with {{VAR}} placeholders
# substituted from the environment, and prepended with the allowlist
# as positive framing so the agent doesn't burn turns on denied tools.
set -eu

: "${PROMPT_FILE:?required env var}"
: "${KIRI_REPO_ROOT:?required (kiri injects this)}"

# Defaults are exported so {{MAX_TURNS}} and {{ALLOWED_TOOLS}} can be
# referenced inside prompt templates even when the workflow leaves
# them unset.
export MAX_TURNS="${MAX_TURNS:-8}"
export ALLOWED_TOOLS="${ALLOWED_TOOLS:-Read,Glob,Grep}"

for dep in claude jq awk; do
  command -v "$dep" >/dev/null 2>&1 || {
    echo "claude-code bundle requires '$dep' on PATH" >&2
    exit 1
  }
done

# CLAUDE_CONFIG_DIR points the CLI at a per-run settings.json so no
# user-level ~/.claude state is consulted — the workflow's env: block
# is the only source of permission truth.
config_dir="$(pwd)/.claude"
mkdir -p "$config_dir"

printf '%s' "$ALLOWED_TOOLS" | jq -R '
  split(",") | map(gsub("^\\s+|\\s+$"; "")) | {permissions: {allow: .}}
' > "$config_dir/settings.json"
export CLAUDE_CONFIG_DIR="$config_dir"

# Slurp the previous step's stdout (piped here by kiri) into KIRI_INPUT
# so prompts can reference {{KIRI_INPUT}}. $() trims one trailing
# newline so single-line outputs (e.g. `echo "Lee"`) render inline;
# multi-line outputs keep their internal newlines.
export KIRI_INPUT="$(cat)"

# Render {{VAR}} placeholders from the environment in a single
# left-to-right pass. Substituted values are not re-scanned, so a
# value containing "{{X}}" stays literal — no infinite loops on
# self-referential content. Unknown vars resolve to empty.
prompt_body=$(awk '
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

prompt="You have access to: $ALLOWED_TOOLS. If you need anything else, end the session with a final message describing what you needed and why.

$prompt_body"

if [ -n "${MODEL:-}" ]; then
  exec claude -p "$prompt" --max-turns "$MAX_TURNS" --model "$MODEL"
else
  exec claude -p "$prompt" --max-turns "$MAX_TURNS"
fi
