#!/bin/sh
# Sends a one-shot chat completion to LM Studio's OpenAI-compatible HTTP
# server (default http://localhost:1234/v1). The prompt is taken from
# PROMPT (inline) or PROMPT_FILE (a template path resolved against
# KIRI_REPO_ROOT), rendered with {{VAR}} placeholders substituted from
# the environment. When both are set, PROMPT wins and PROMPT_FILE is
# ignored. Non-streaming, no tool use — single completion in, message
# content out. Point BASE_URL at any OpenAI-compatible local server
# (Ollama's compat shim, llama.cpp, vLLM, …) to repurpose the bundle.
set -eu

: "${KIRI_REPO_ROOT:?required (kiri injects this)}"

# Defaults exported so {{BASE_URL}} and {{MAX_TOKENS}} can be referenced
# inside prompt templates even when the workflow leaves them unset.
export BASE_URL="${BASE_URL:-http://localhost:1234/v1}"
export MAX_TOKENS="${MAX_TOKENS:-2048}"

for dep in curl jq awk; do
  command -v "$dep" >/dev/null 2>&1 || {
    echo "lm-studio bundle requires '$dep' on PATH" >&2
    exit 1
  }
done

# Resolve the prompt source. PROMPT wins over PROMPT_FILE when both
# are set. Verify the file exists *before* the awk render — POSIX
# `set -e` doesn't propagate failures from `$()` inside an
# assignment, so a missing file would otherwise silently leave
# $prompt empty and we'd POST an empty completion.
if [ -n "${PROMPT:-}" ]; then
  prompt_source="$PROMPT"
elif [ -n "${PROMPT_FILE:-}" ]; then
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
# non-C locales can't widen `[A-Z]` to accented uppercase.
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
# regardless of quotes / newlines / backslashes in the text. MODEL
# and TEMPERATURE are omitted from the body when unset, so the server
# uses whichever model is currently loaded and its own sampling
# default.
body=$(jq -nc \
  --arg prompt "$prompt" \
  --arg model "${MODEL:-}" \
  --arg temperature "${TEMPERATURE:-}" \
  --argjson max_tokens "$MAX_TOKENS" \
  '{
    messages: [{ role: "user", content: $prompt }],
    max_tokens: $max_tokens,
    stream: false
  }
  + (if $model == "" then {} else { model: $model } end)
  + (if $temperature == "" then {} else { temperature: ($temperature | tonumber) } end)')

# `--fail-with-body` (curl 7.76+) keeps the response body on HTTP
# errors so the caller can see what the server actually said. Without
# it, 4xx/5xx bodies are dropped on the floor and debugging is guesswork.
response=$(curl -sS --fail-with-body \
  -H "Content-Type: application/json" \
  -d "$body" \
  "$BASE_URL/chat/completions") || {
  echo "lm-studio: request to $BASE_URL/chat/completions failed" >&2
  [ -n "${response:-}" ] && echo "$response" >&2
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

printf '%s\n' "$content"
