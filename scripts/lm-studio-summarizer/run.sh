#!/bin/sh
# Summarises a kiri workflow run for the activity feed via LM Studio's
# OpenAI-compatible HTTP server (default http://localhost:1234/v1).
# Prompt is taken from PROMPT (inline), PROMPT_FILE (a template path
# resolved against KIRI_REPO_ROOT), or a baked-in default that inlines
# the run-context JSON. When both PROMPT and PROMPT_FILE are set,
# PROMPT wins and PROMPT_FILE is ignored. Spawned by kiri after the
# workflow's `steps:` complete on non-cancelled runs; this bundle's
# stdout becomes the run's `summary` field when it exits 0. Point
# BASE_URL at any OpenAI-compatible local server to repurpose the
# bundle.
set -eu

: "${KIRI_REPO_ROOT:?required (kiri injects this)}"
: "${KIRI_RUN_CONTEXT_FILE:?required (kiri injects this)}"

# Defaults exported so {{BASE_URL}} and {{MAX_TOKENS}} can be referenced
# inside prompt templates even when the workflow leaves them unset.
export BASE_URL="${BASE_URL:-http://localhost:1234/v1}"
export MAX_TOKENS="${MAX_TOKENS:-2048}"

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
# render — POSIX `set -e` doesn't propagate failures from `$()` inside
# an assignment, so a missing file would otherwise silently leave
# $prompt empty and we'd POST an empty completion.
if [ -n "${PROMPT:-}" ]; then
  prompt_source="$PROMPT"
elif [ -n "${PROMPT_FILE:-}" ]; then
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
$KIRI_RUN_CONTEXT"
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

# Build the request body with jq so the prompt is escaped correctly
# regardless of quotes / newlines / backslashes in the text. MODEL is
# omitted from the body when unset, so the server uses whichever model
# is currently loaded.
body=$(jq -nc \
  --arg prompt "$prompt" \
  --arg model "${MODEL:-}" \
  --argjson max_tokens "$MAX_TOKENS" \
  '{
    messages: [{ role: "user", content: $prompt }],
    max_tokens: $max_tokens,
    stream: false
  }
  + (if $model == "" then {} else { model: $model } end)')

# `--fail-with-body` (curl 7.76+) keeps the response body on HTTP
# errors so the caller can see what the server actually said.
response=$(curl -sS --fail-with-body \
  -H "Content-Type: application/json" \
  -d "$body" \
  "$BASE_URL/chat/completions") || {
  echo "lm-studio-summarizer: request to $BASE_URL/chat/completions failed" >&2
  [ -n "${response:-}" ] && echo "$response" >&2
  exit 1
}

content=$(printf '%s' "$response" | jq -r '.choices[0].message.content // empty')
if [ -z "$content" ]; then
  echo "lm-studio-summarizer: response did not contain choices[0].message.content" >&2
  echo "$response" >&2
  exit 1
fi

printf '%s\n' "$content"
