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

The simplest setup is the modeline at the top of each workflow file (the
generated \`workflows/example.yaml\` has one):

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

/** Contents of the scaffolded `workflows/example.yaml`. */
export const EXAMPLE_WORKFLOW_YAML = `# yaml-language-server: $schema=../.kiri/workflow.schema.json

name: example
steps:
  - use: example
`;

/** Contents of the scaffolded example bundle's `run.sh`. */
export const EXAMPLE_RUN_SCRIPT = `#!/bin/sh
echo "hello from kiri"
`;

/** Contents of the scaffolded `scripts/claude-code/run.sh`. */
export const CLAUDE_CODE_RUN_SCRIPT = `#!/bin/sh
# Spawns the Claude Code CLI with a per-run permission allowlist
# synthesised from ALLOWED_TOOLS. The prompt is read from PROMPT_FILE
# (resolved against KIRI_REPO_ROOT) with the allowlist prepended as
# positive framing so the agent doesn't burn turns on denied tools.
set -eu

: "\${PROMPT_FILE:?required env var}"
: "\${KIRI_REPO_ROOT:?required (kiri injects this)}"

MAX_TURNS="\${MAX_TURNS:-8}"
ALLOWED_TOOLS="\${ALLOWED_TOOLS:-Read,Glob,Grep}"

for dep in claude jq; do
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
  split(",") | map(gsub("^\\\\s+|\\\\s+$"; "")) | {permissions: {allow: .}}
' > "$config_dir/settings.json"
export CLAUDE_CONFIG_DIR="$config_dir"

prompt_body=$(cat "$KIRI_REPO_ROOT/$PROMPT_FILE")
prompt="You have access to: $ALLOWED_TOOLS. If you need anything else, end the session with a final message describing what you needed and why.

$prompt_body"

if [ -n "\${MODEL:-}" ]; then
  exec claude -p "$prompt" --max-turns "$MAX_TURNS" --model "$MODEL"
else
  exec claude -p "$prompt" --max-turns "$MAX_TURNS"
fi
`;

/** Contents of the scaffolded `scripts/claude-code/README.md`. */
export const CLAUDE_CODE_README = `# claude-code bundle

A workflow step that spawns the Claude Code CLI with a permission
allowlist synthesised from the workflow's \`env:\` block.

Reference it from a workflow:

\`\`\`yaml
- use: claude-code
  env:
    PROMPT_FILE: prompts/my-prompt.tpl
    MAX_TURNS: "8"
    ALLOWED_TOOLS: "Read,Glob,Grep"
    MODEL: opus               # optional
\`\`\`

## Env-var contract

| Var | Required | Default | Description |
| --- | --- | --- | --- |
| \`PROMPT_FILE\` | yes | — | Path to the prompt template, resolved against \`KIRI_REPO_ROOT\`. |
| \`MAX_TURNS\` | no | \`8\` | Hard cap on the number of agent turns. |
| \`ALLOWED_TOOLS\` | no | \`Read,Glob,Grep\` | Comma-separated tool names, e.g. \`Read,Glob,Grep\` or \`Bash(gh pr view:*)\`. Defaults to read-only tooling. |
| \`MODEL\` | no | — | Override the model. If unset, \`claude\` picks its default. |

\`KIRI_REPO_ROOT\` is supplied by kiri.

## What \`run.sh\` does

1. Synthesises \`<scratch>/.claude/settings.json\` with \`permissions.allow\`
   from \`ALLOWED_TOOLS\` and points \`CLAUDE_CONFIG_DIR\` at it. No
   user-level \`~/.claude/settings.json\` is consulted — the workflow
   YAML is the only source of permission truth.
2. Builds the prompt from \`$KIRI_REPO_ROOT/$PROMPT_FILE\` and prepends
   "You have access to: …. If you need anything else, end the session
   with a final message describing what you needed and why." so the
   agent doesn't burn turns on denied tools.
3. Spawns \`claude -p "$PROMPT" --max-turns "$MAX_TURNS"\` (plus
   \`--model "$MODEL"\` if set). The agent's final message lands on
   stdout and shows up in the run feed.

## Dependencies

The \`claude\` CLI and \`jq\` must both be on \`PATH\`. The bundle
fails with a clear error at the top of the run if either is missing.

## Cost capture (deferred)

A later iteration will switch the spawn to \`--output-format json\`,
parse the transcript for \`cost_usd\`, \`tokens_in\`, \`tokens_out\`,
and \`model\`, and write them to \`$KIRI_META_FILE\` so the feed entry
shows cost in its header.
`;

/** Relative paths reported by `initRepo`. */
const SCHEMA_REL_PATH = ".kiri/workflow.schema.json";
const README_REL_PATH = "README.md";
const EXAMPLE_REL_PATH = "workflows/example.yaml";
const EXAMPLE_BUNDLE_RUN_REL_PATH = "scripts/example/run.sh";
const CLAUDE_CODE_RUN_REL_PATH = "scripts/claude-code/run.sh";
const CLAUDE_CODE_README_REL_PATH = "scripts/claude-code/README.md";
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
 * Bootstrap a kiri-ready repo at `cwd`: scaffold `workflows/` with a README
 * and example workflow, drop in the example and `claude-code` script bundles,
 * (re)write the JSON Schema file, and add `.kiri/` to `.gitignore` if one
 * exists. User-authored README/YAML/script files are never overwritten —
 * only missing files are created. The schema file is always refreshed.
 */
export function initRepo(cwd: string): InitResult {
  const workflowsDir = join(cwd, "workflows");
  const exampleBundleDir = join(cwd, "scripts", "example");
  const claudeCodeBundleDir = join(cwd, "scripts", "claude-code");
  mkdirSync(workflowsDir, { recursive: true });
  mkdirSync(exampleBundleDir, { recursive: true });
  mkdirSync(claudeCodeBundleDir, { recursive: true });

  const created: string[] = [];
  const skipped: string[] = [];

  writeIfMissing(join(cwd, "README.md"), README_REL_PATH, KIRI_README, created, skipped);
  writeIfMissing(
    join(workflowsDir, "example.yaml"),
    EXAMPLE_REL_PATH,
    EXAMPLE_WORKFLOW_YAML,
    created,
    skipped,
  );
  writeIfMissing(
    join(exampleBundleDir, "run.sh"),
    EXAMPLE_BUNDLE_RUN_REL_PATH,
    EXAMPLE_RUN_SCRIPT,
    created,
    skipped,
    0o755,
  );
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

  writeSchemaFile(cwd);
  const gitignoreUpdated = ensureKiriIgnored(cwd);

  return {
    created,
    skipped,
    schemaPath: SCHEMA_REL_PATH,
    gitignoreUpdated,
  };
}
