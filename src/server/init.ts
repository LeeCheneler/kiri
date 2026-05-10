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
# Spawns the Claude Code CLI with the prompt read from PROMPT_FILE
# (resolved against KIRI_REPO_ROOT) and rendered with {{VAR}}
# placeholders substituted from the environment. Tool permissions
# are deferred to the user's own ~/.claude/settings.json — keeps
# this bundle out of the credential-resolution path so claude's
# normal login flow keeps working.
set -eu

: "\${PROMPT_FILE:?required env var}"
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

# Verify the prompt file exists *before* the awk render — POSIX
# \`set -e\` doesn't propagate failures from \`$()\` inside an
# assignment, so a missing file would otherwise silently leave
# \$prompt empty and we'd exec \`claude -p ""\`.
[ -f "$KIRI_REPO_ROOT/$PROMPT_FILE" ] || {
  echo "claude-code: prompt file not found: $PROMPT_FILE" >&2
  exit 1
}

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
prompt=$(LC_ALL=C awk '
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
' "$KIRI_REPO_ROOT/$PROMPT_FILE")

if [ -n "\${MODEL:-}" ]; then
  exec claude -p "$prompt" --max-turns "$MAX_TURNS" --model "$MODEL"
else
  exec claude -p "$prompt" --max-turns "$MAX_TURNS"
fi
`;

/** Contents of the scaffolded `scripts/claude-code/README.md`. */
export const CLAUDE_CODE_README = `# claude-code bundle

A workflow step that spawns the Claude Code CLI with a prompt rendered
from a template under \`prompts/\`.

Minimal usage — only \`PROMPT_FILE\` is required:

\`\`\`yaml
- use: claude-code
  env:
    PROMPT_FILE: prompts/my-prompt.tpl
\`\`\`

Full reference, all knobs explicit:

\`\`\`yaml
- use: claude-code
  env:
    PROMPT_FILE: prompts/my-prompt.tpl   # required
    MAX_TURNS: "8"                       # optional, default "8"
    MODEL: opus                          # optional, no default — claude picks
\`\`\`

## Env-var contract

| Var | Required | Default | Description |
| --- | --- | --- | --- |
| \`PROMPT_FILE\` | yes | — | Path to the prompt template. If relative, resolved against \`KIRI_REPO_ROOT\`; absolute paths are passed through as-is. |
| \`MAX_TURNS\` | no | \`8\` | Hard cap on the number of agent turns. |
| \`MODEL\` | no | — | Override the model. If unset, \`claude\` picks its default. |

\`KIRI_REPO_ROOT\` is supplied by kiri.

## Tool permissions

This bundle does not configure tool permissions — the agent runs with
whatever your \`~/.claude/settings.json\` allows. Constrain a workflow
by writing the prompt around the tools you want it to use, or set up
your global claude settings to match the strictness you want.

## What \`run.sh\` does

1. Reads the previous step's stdout (piped here by kiri) into
   \`KIRI_INPUT\` and renders \`$KIRI_REPO_ROOT/$PROMPT_FILE\` —
   substituting \`{{VAR}}\` placeholders from the environment (see
   *Prompt templates* below).
2. Spawns \`claude -p "$prompt" --max-turns "$MAX_TURNS"\` (plus
   \`--model "$MODEL"\` if set). The agent's final message lands on
   stdout and shows up in the run feed.

## Prompt templates

Prompt files support \`{{VAR}}\` placeholders, substituted from the
environment in a single left-to-right pass. Names must be uppercase
letters, digits, or underscores (matching the env-var convention).
Unknown vars resolve to empty. Substituted values are not re-scanned,
so a value that itself contains \`{{X}}\` stays literal — no infinite
loops on self-referential content.

### Substitutable vars

| Var | Source |
| --- | --- |
| \`{{KIRI_INPUT}}\` | Previous step's stdout (one trailing newline trimmed). |
| \`{{KIRI_RUN_ID}}\` | Kiri-injected run identifier. |
| \`{{KIRI_STEP_INDEX}}\` | Zero-based index of this step in the run. |
| \`{{KIRI_REPO_ROOT}}\` | Absolute path of the workflow repo root. |
| \`{{KIRI_BUNDLE_DIR}}\` | Absolute path of this bundle's directory. |
| \`{{KIRI_META_FILE}}\` | Path the bundle writes step metadata to. |
| \`{{PROMPT_FILE}}\`, \`{{MAX_TURNS}}\` | Bundle env-var contract values, defaulted as documented above. |
| \`{{MODEL}}\` | Same — but resolves to empty when unset, since \`MODEL\` has no default. |
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
# Summarises a kiri workflow run for the activity feed by feeding the
# run envelope to Claude Code (haiku) and asking for one or two
# sentences of plain prose. Spawned by kiri after the workflow's
# \`steps:\` complete on non-cancelled runs; this bundle's stdout
# becomes the run's \`summary\` field when it exits 0.
#
# Zero-config by design — model and prompt are baked in. Fork the
# bundle (cp -r scripts/claude-code-summarizer scripts/my-summarizer
# and edit) if you want a different tone, framing, or model.
set -eu

: "\${KIRI_RUN_CONTEXT_FILE:?required (kiri injects this)}"

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

## What \`run.sh\` does

1. Reads \`KIRI_RUN_CONTEXT_FILE\` (kiri-injected) — a JSON file under
   the per-run scratch dir containing the workflow name, status,
   duration, and per-step kind / status / duration / stdout / stderr /
   error.
2. Embeds the JSON into a baked-in prompt asking for a brief
   plain-prose summary suitable for a feed entry.
3. Spawns \`claude -p "$prompt" --max-turns 1 --model haiku\` — the
   alias keeps the bundle on whichever haiku is current without a
   future bundle bump.
4. Claude's stdout becomes the run's \`summary\` field.

## Zero config by design

There are no env vars to set on this bundle. The prompt and model are
baked into \`run.sh\` so a workflow can declare
\`summarize: { use: claude-code-summarizer }\` and forget about it. If
you want a different tone, framing, or model, fork the bundle:

\`\`\`
cp -r scripts/claude-code-summarizer scripts/my-summarizer
$EDITOR scripts/my-summarizer/run.sh
\`\`\`

Then reference your fork:

\`\`\`yaml
summarize:
  use: my-summarizer
\`\`\`

## Failure handling

A summariser failure does not affect the run's status — \`runs.status\`
stays \`ok\` or \`failed\` as determined by the workflow steps. The run's
\`summary\` field stays null when the summariser fails. The summariser's
stdout/stderr are captured on a \`run_steps\` row (with \`is_summary\`
set) so the run detail page can surface them for debugging.

## Dependencies

The \`claude\` CLI must be on \`PATH\`. The bundle exits non-zero with a
clear error if it isn't.
`;

/** Relative paths reported by `initRepo`. */
const SCHEMA_REL_PATH = ".kiri/workflow.schema.json";
const README_REL_PATH = "README.md";
const CLAUDE_CODE_RUN_REL_PATH = "scripts/claude-code/run.sh";
const CLAUDE_CODE_README_REL_PATH = "scripts/claude-code/README.md";
const CLAUDE_CODE_SUMMARIZER_RUN_REL_PATH = "scripts/claude-code-summarizer/run.sh";
const CLAUDE_CODE_SUMMARIZER_README_REL_PATH = "scripts/claude-code-summarizer/README.md";
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
 * Bootstrap a kiri-ready repo at `cwd`: create an empty `workflows/`
 * directory, drop in a repo README plus the `claude-code` and
 * `claude-code-summarizer` bundles, (re)write the JSON Schema file,
 * and add `.kiri/` to `.gitignore` if one exists. User-authored
 * files are never overwritten — only missing files are created. The
 * schema file is always refreshed.
 */
export function initRepo(cwd: string): InitResult {
  const workflowsDir = join(cwd, "workflows");
  const claudeCodeBundleDir = join(cwd, "scripts", "claude-code");
  const claudeCodeSummarizerBundleDir = join(cwd, "scripts", "claude-code-summarizer");
  mkdirSync(workflowsDir, { recursive: true });
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

  writeSchemaFile(cwd);
  const gitignoreUpdated = ensureKiriIgnored(cwd);

  return {
    created,
    skipped,
    schemaPath: SCHEMA_REL_PATH,
    gitignoreUpdated,
  };
}
