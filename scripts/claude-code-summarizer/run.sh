#!/bin/sh
# Summarises a kiri workflow run for the activity feed by feeding the
# run envelope to Claude Code (haiku) and asking for one or two
# sentences of plain prose. Spawned by kiri after the workflow's
# `steps:` complete on non-cancelled runs; this bundle's stdout
# becomes the run's `summary` field when it exits 0.
#
# Zero-config by design — model and prompt are baked in. Fork the
# bundle (cp -r scripts/claude-code-summarizer scripts/my-summarizer
# and edit) if you want a different tone, framing, or model.
set -eu

: "${KIRI_RUN_CONTEXT_FILE:?required (kiri injects this)}"

command -v claude >/dev/null 2>&1 || {
  echo "claude-code-summarizer bundle requires 'claude' on PATH" >&2
  exit 1
}

[ -f "$KIRI_RUN_CONTEXT_FILE" ] || {
  echo "claude-code-summarizer: run-context file not found: $KIRI_RUN_CONTEXT_FILE" >&2
  exit 1
}

context=$(cat "$KIRI_RUN_CONTEXT_FILE")

prompt="You are writing a one or two sentence summary of a kiri workflow run for an activity feed. Lead with what happened — read the step stdout/stderr to find the substance. No markdown, no headers, no bullets, no preamble like 'the workflow ran'. Plain prose, under 40 words.

Run envelope (JSON):
$context"

exec claude -p "$prompt" --max-turns 1 --model haiku
