# claude-code-summarizer bundle

A workflow `summarize:` step that produces a one-or-two-sentence
summary of a run for the activity feed. Spawned by kiri after the
workflow's `steps:` complete on non-cancelled runs; this bundle's
stdout becomes the run's `summary` when it exits successfully.

## Usage

Reference it from a workflow's `summarize:` field — no env vars
needed:

```yaml
name: my-workflow
steps:
  - sh: echo "hello"
summarize:
  use: claude-code-summarizer
```

## What `run.sh` does

1. Reads `KIRI_RUN_CONTEXT_FILE` (kiri-injected) — a JSON file under
   the per-run scratch dir containing the workflow name, status,
   duration, and per-step kind / status / duration / stdout / stderr /
   error.
2. Embeds the JSON into a baked-in prompt asking for a brief
   plain-prose summary suitable for a feed entry.
3. Spawns `claude -p "$prompt" --max-turns 1 --model haiku` — the
   alias keeps the bundle on whichever haiku is current without a
   future bundle bump.
4. Claude's stdout becomes the run's `summary` field.

## Zero config by design

There are no env vars to set on this bundle. The prompt and model are
baked into `run.sh` so a workflow can declare
`summarize: { use: claude-code-summarizer }` and forget about it. If
you want a different tone, framing, or model, fork the bundle:

```
cp -r scripts/claude-code-summarizer scripts/my-summarizer
$EDITOR scripts/my-summarizer/run.sh
```

Then reference your fork:

```yaml
summarize:
  use: my-summarizer
```

## Failure handling

A summariser failure does not affect the run's status — `runs.status`
stays `ok` or `failed` as determined by the workflow steps. The run's
`summary` field stays null when the summariser fails. The summariser's
stdout/stderr are captured on a `run_steps` row (with `is_summary`
set) so the run detail page can surface them for debugging.

## Dependencies

The `claude` CLI must be on `PATH`. The bundle exits non-zero with a
clear error if it isn't.
