# Examples

A complete, runnable kiri workspace kept as a reference. `kiri init`
scaffolds only a minimal hello-world workflow — these are the worked
examples it deliberately leaves out, so they stay discoverable without
being forced on every new repo.

## Layout

```
examples/
  scripts/
    claude-code/              # spawn the Claude Code CLI with a rendered prompt
    claude-code-summarizer/   # summarise: step backed by Claude Code
    lm-studio/                # one-shot completion against an OpenAI-compatible local server
    lm-studio-summarizer/     # summarise: step backed by LM Studio
  workflows/
    daily-briefing.yaml       # composes a sh: fetch, a publish: artefact, and a summary
  prompts/
    daily-briefing.tpl        # prompt template for the briefing
```

Each bundle's `README.md` documents its env-var contract — the
load-bearing reference for authoring your own bundles.

## Using a bundle

Bundles are plain bash. Copy the one you want into your own workspace's
`scripts/` directory and reference it from a workflow's `use:` field:

```sh
cp -r examples/scripts/claude-code path/to/your/workspace/scripts/
```

## Running the examples

This directory is itself a kiri workspace. From the repo root:

```sh
cd examples
kiri
```

The kiri project runs `daily-briefing.yaml` as its own dogfood and smoke
test — see `CONTRIBUTING.md`.
