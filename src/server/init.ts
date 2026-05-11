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
\`KIRI_STEP_INDEX\`, \`KIRI_META_FILE\`, \`KIRI_REPO_ROOT\` — plus OS
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
| \`{{KIRI_META_FILE}}\` | Path the bundle writes step metadata to. |
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

## Cost capture (deferred)

A later iteration will switch the spawn to \`--output-format json\`,
parse the transcript for \`cost_usd\`, \`tokens_in\`, \`tokens_out\`,
and \`model\`, and write them to \`$KIRI_META_FILE\` so the feed entry
shows cost in its header.
`;

/** Contents of the scaffolded `scripts/claude-code-summarizer/run.sh`. */
export const CLAUDE_CODE_SUMMARIZER_RUN_SCRIPT = `#!/bin/sh
# Summarises a kiri workflow run for the activity feed. Spawns Claude
# Code with a prompt taken from PROMPT (inline), PROMPT_FILE (a template
# path resolved against KIRI_REPO_ROOT), or a baked-in default that
# inlines the run-context JSON. When both PROMPT and PROMPT_FILE are
# set, PROMPT wins and PROMPT_FILE is ignored. Spawned by kiri after
# the workflow's \`steps:\` complete on non-cancelled runs; this bundle's
# stdout becomes the run's \`summary\` field when it exits 0.
set -eu

: "\${KIRI_REPO_ROOT:?required (kiri injects this)}"
: "\${KIRI_RUN_CONTEXT_FILE:?required (kiri injects this)}"

# Defaults exported so {{MAX_TURNS}} and {{MODEL}} can be referenced
# inside prompt templates even when the workflow leaves them unset.
export MAX_TURNS="\${MAX_TURNS:-1}"
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

# Resolve the prompt source. PROMPT wins over PROMPT_FILE when both are
# set; both fall through to a baked-in default that inlines the
# run-context JSON so a workflow with no env vars produces the same
# prompt as before. Verify the file exists *before* the awk render —
# POSIX \`set -e\` doesn't propagate failures from \`$()\` inside an
# assignment, so a missing file would otherwise silently leave
# \$prompt empty and we'd exec \`claude -p ""\`.
if [ -n "\${PROMPT:-}" ]; then
  prompt_source="$PROMPT"
elif [ -n "\${PROMPT_FILE:-}" ]; then
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

A workflow \`summarize:\` step that produces a one-or-two-sentence
summary of a run for the activity feed. Spawned by kiri after the
workflow's \`steps:\` complete on non-cancelled runs; this bundle's
stdout becomes the run's \`summary\` when it exits successfully.

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
    MAX_TURNS: "1"                       # optional, default 1
\`\`\`

## Env-var contract

| Var | Required | Default | Description |
| --- | --- | --- | --- |
| \`PROMPT\` | no | baked-in summariser prompt | Inline prompt text. Wins over \`PROMPT_FILE\` when both are set. |
| \`PROMPT_FILE\` | no | baked-in summariser prompt | Path to a prompt template. If relative, resolved against \`KIRI_REPO_ROOT\`; absolute paths are passed through as-is. |
| \`MODEL\` | no | \`haiku\` | Passed via \`--model\`. |
| \`MAX_TURNS\` | no | \`1\` | Passed via \`--max-turns\`. |

\`KIRI_REPO_ROOT\` and \`KIRI_RUN_CONTEXT_FILE\` are supplied by kiri.

### Precedence

When both \`PROMPT\` and \`PROMPT_FILE\` are set, \`PROMPT\` wins and
\`PROMPT_FILE\` is ignored — its content is not read, validated, or
concatenated. When neither is set, the bundle falls back to a baked-in
prompt that inlines the run-context JSON. Matches \`claude-code\`'s
precedence rule.

### Run context

\`KIRI_RUN_CONTEXT_FILE\` points at a JSON file under the per-run scratch
dir containing the workflow name, status, duration, and per-step
kind / status / duration / stdout / stderr / error. The baked-in
default inlines this JSON directly into the prompt. A user-supplied
\`PROMPT\` or \`PROMPT_FILE\` replaces the *framing* only — if you want
the envelope content in your prompt, reference \`{{KIRI_RUN_CONTEXT_FILE}}\`
to get the path and read it inside the prompt, or splice the path
into a \`sh:\` step that pre-processes it however you like.

## Zero config by design

Zero config is still the default posture: a workflow declaring
\`summarize: { use: claude-code-summarizer }\` with no env vars
produces the same prompt, model (\`haiku\`), and turn budget (\`1\`) as
before. The env vars above are escape hatches for workflows that want
to shape the summary without forking the bundle.

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
| \`{{KIRI_META_FILE}}\` | Path the bundle writes step metadata to. |
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

/** Contents of the scaffolded `workflows/pr-review-queue.yaml`. */
export const PR_REVIEW_QUEUE_WORKFLOW = `# yaml-language-server: $schema=../.kiri/workflow.schema.json

name: PR Review Queue
steps:
  - sh: |
      set -eu
      prs=$(gh search prs --review-requested=@me --state=open)
      if [ -z "$prs" ]; then
        echo "No PRs awaiting your review."
      else
        echo "$prs"
      fi
summarize:
  use: claude-code-summarizer
`;

/** Contents of the scaffolded `workflows/hackernews-digest.yaml`. */
export const HACKERNEWS_DIGEST_WORKFLOW = `# yaml-language-server: $schema=../.kiri/workflow.schema.json

name: HackerNews Digest
steps:
  - sh: |
      set -eu
      limit=10
      ids=$(curl -fsSL "https://hacker-news.firebaseio.com/v0/topstories.json" \\
        | jq -r ".[:\${limit}][]")
      [ -n "$ids" ] || { echo "Could not fetch HackerNews top stories." >&2; exit 1; }
      printf '['
      first=1
      for id in $ids; do
        [ "$first" = 1 ] && first=0 || printf ','
        curl -fsSL "https://hacker-news.firebaseio.com/v0/item/\${id}.json"
      done
      printf ']'
publish:
  - name: article
    title: HackerNews Top Stories
    use: claude-code
    env:
      PROMPT_FILE: prompts/hackernews-digest.tpl
      MODEL: sonnet
summarize:
  use: claude-code-summarizer
`;

/** Contents of the scaffolded `prompts/hackernews-digest.tpl`. */
export const HACKERNEWS_DIGEST_PROMPT = `You are formatting today's HackerNews top stories as a long-form
markdown digest.

The run envelope is at {{KIRI_RUN_CONTEXT_FILE}}. Read that file with
the Read tool, parse it as JSON, and locate \`steps[0].stdout\` — that
string is a JSON array of HN items you should format.

Each item has fields like \`title\`, \`url\`, \`by\`, \`score\`, \`descendants\`
(comment count), and \`id\`. Some items have no \`url\` (self-posts) — for
those, use \`https://news.ycombinator.com/item?id=<id>\` as the link.

Produce markdown with this shape:

## HackerNews Top Stories

A one-sentence lede observing what's notable across the list as a
whole (e.g. "AI agents and infra dominate; one curious throwback
about ..."). Base this only on titles — do **not** pretend to have
read the articles or fabricate per-story takes.

Then for each story, in input order:

### N. {title}
[link]({url}) · [discussion](https://news.ycombinator.com/item?id={id}) · {score} points · {descendants} comments · by {by}

Output only the markdown. No preamble, no code fences.
`;

/** Relative paths reported by `initRepo`. */
const SCHEMA_REL_PATH = ".kiri/workflow.schema.json";
const README_REL_PATH = "README.md";
const CLAUDE_CODE_RUN_REL_PATH = "scripts/claude-code/run.sh";
const CLAUDE_CODE_README_REL_PATH = "scripts/claude-code/README.md";
const CLAUDE_CODE_SUMMARIZER_RUN_REL_PATH = "scripts/claude-code-summarizer/run.sh";
const CLAUDE_CODE_SUMMARIZER_README_REL_PATH = "scripts/claude-code-summarizer/README.md";
const PR_REVIEW_QUEUE_WORKFLOW_REL_PATH = "workflows/pr-review-queue.yaml";
const HACKERNEWS_DIGEST_WORKFLOW_REL_PATH = "workflows/hackernews-digest.yaml";
const HACKERNEWS_DIGEST_PROMPT_REL_PATH = "prompts/hackernews-digest.tpl";
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
 * drop in a repo README, the `claude-code` and `claude-code-summarizer`
 * bundles, the `pr-review-queue` and `hackernews-digest` starter
 * workflows, (re)write the JSON Schema file, and add `.kiri/` to
 * `.gitignore` if one exists. User-authored files are never
 * overwritten — only missing files are created. The schema file is
 * always refreshed.
 */
export function initRepo(cwd: string): InitResult {
  const workflowsDir = join(cwd, "workflows");
  const promptsDir = join(cwd, "prompts");
  const claudeCodeBundleDir = join(cwd, "scripts", "claude-code");
  const claudeCodeSummarizerBundleDir = join(cwd, "scripts", "claude-code-summarizer");
  mkdirSync(workflowsDir, { recursive: true });
  mkdirSync(promptsDir, { recursive: true });
  mkdirSync(claudeCodeBundleDir, { recursive: true });
  mkdirSync(claudeCodeSummarizerBundleDir, { recursive: true });

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
    join(workflowsDir, "pr-review-queue.yaml"),
    PR_REVIEW_QUEUE_WORKFLOW_REL_PATH,
    PR_REVIEW_QUEUE_WORKFLOW,
    created,
    skipped,
  );
  writeIfMissing(
    join(workflowsDir, "hackernews-digest.yaml"),
    HACKERNEWS_DIGEST_WORKFLOW_REL_PATH,
    HACKERNEWS_DIGEST_WORKFLOW,
    created,
    skipped,
  );
  writeIfMissing(
    join(promptsDir, "hackernews-digest.tpl"),
    HACKERNEWS_DIGEST_PROMPT_REL_PATH,
    HACKERNEWS_DIGEST_PROMPT,
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
