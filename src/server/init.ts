import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { kiriConfigJsonSchema } from "./config/json-schema.ts";
import type { ConfigStore } from "./config/store.ts";
import { workflowJsonSchema } from "./workflows/index.ts";

/** Contents of the scaffolded repo-root `README.md`. */
export const KIRI_README = `# Kiri

This is a kiri workflow repo. Kiri is a local-first, git-based workflow
orchestrator — run \`kiri\` in this directory to start it and visit the local
URL it prints. Full documentation lives at https://kiri.build/docs.

## Workflow definitions

Workflow files live in \`workflows/\` as \`*.yaml\` files. Each file defines a
single workflow. Kiri loads them on startup, validates each against
\`.kiri/workflow.schema.json\`, and registers it by \`name\`.

### Shape

\`\`\`yaml
name: my-workflow
description: One-line summary shown on the workflow page.  # optional
group: Examples                                            # optional, groups related workflows
steps:
  - use: my-bundle
    name: Greet                                             # optional, short label shown as the step title in the UI
    env:
      GREETING: hello
  - sh: |
      echo "post-processing"
\`\`\`

Workflows are linear — steps run in declared order, and a step passes
data forward by declaring an \`id\` that later phases reference (see
*Environment variables*). No branches, conditionals, or fan-out/fan-in.

\`description\` and \`group\` are optional top-level metadata: \`description\`
renders as the deck beneath the workflow's title; \`group\` buckets the
workflow under that label in the workflow catalog and becomes the page
eyebrow, so related workflows read as a set.

### Step variants

Each step is exactly one of:

#### \`use: <name>\`

References a **script bundle** at \`bundles/<name>/run.sh\`. A bundle is a
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

#### \`llm: { model, prompt }\`

Runs a **first-party model completion** — no bundle. The model's text
response becomes the step's output. \`model\` is a \`provider:model\` id whose
prefix names an entry in \`kiri.yaml\` (see below); supply exactly one
of \`prompt\` (inline) or \`prompt_file\`. Upstream data arrives through
env refs, rendered into the prompt under the name you give them.

\`\`\`yaml
- llm:
    model: anthropic:claude-haiku-4-5
    prompt: |
      Summarise this in three bullets.

      {{DATA}}
  env:
    DATA:
      step: fetch
\`\`\`

\`articles:\` and \`summarize:\` accept \`llm:\` too, with the same rules.

#### Optional \`name\` and \`description\`

Either shape accepts an optional \`name\` and \`description\`. \`name\` is a
short label shown as the step's title in the Schema tab and the run
timeline; it defaults to the bundle reference (\`use:\`) or the script's
first non-empty line (\`sh:\`), so set it to keep multi-line scripts
readable. \`description\` is longer detail revealed when the step's row is
expanded.

### Environment variables

\`env:\` is an optional flat map passed to the step. Each value is either
a literal string or a structured reference: \`{ input: <name> }\` to a
declared workflow input, \`{ step: <id> }\` to an earlier step's stdout
(give that step an \`id:\`), \`{ step: <id>, output: <name> }\` to one of
its named outputs (see *Named outputs* below), or \`{ article: <slug> }\`
to an already-produced article — valid on \`articles:\` entries and
\`summarize:\` only. References are validated at load time and resolved
at spawn. Each bundle defines its own contract for the keys it
expects; kiri doesn't validate values.

Kiri injects its own scoped vars on every step — \`KIRI_RUN_ID\`,
\`KIRI_STEP_INDEX\`, \`KIRI_REPO_ROOT\` — plus OS
essentials (\`PATH\`, \`HOME\`, \`USER\`, \`LOGNAME\`). These are applied
*after* user \`env:\` and overwrite on collision, so a workflow can't
shadow them. Workflow \`env:\` keys starting with \`KIRI_\` are rejected
at load time.

\`use:\` steps additionally get \`KIRI_BUNDLE_DIR\` pointing at the
bundle's source directory. Steps run with their cwd set to a per-run
scratch dir, so bundles must read sidecar files via this env var
(\`cat "$KIRI_BUNDLE_DIR/prompt.tpl"\`) rather than relative paths.

Steps get **empty stdin** — data reaches a phase only through the env
refs it declares. That includes \`articles:\` entries and \`summarize:\`:
wire in exactly what each needs with \`{ step: }\` / \`{ step, output }\` /
\`{ article: }\` refs.

## LLM providers

\`llm:\` steps reference a model by a \`provider:model\` id. The provider
prefix names an entry under \`providers:\` in your workspace-root \`kiri.yaml\`
(kept in git) — kiri's structured config file. Kiri scaffolds a commented
\`kiri.yaml\` for you; uncomment and edit it to declare providers. You only
need them if you use \`llm:\` steps.

\`\`\`yaml
# kiri.yaml
providers:
  anthropic:
    type: anthropic          # anthropic | openai | openai-compatible
    api_key:
      env: ANTHROPIC_API_KEY  # API keys are always { env: <NAME> } refs — never a literal
  local:
    type: openai-compatible
    base_url: http://localhost:1234/v1   # required for openai-compatible (LM Studio, Ollama, …)
\`\`\`

An API key is only ever a \`{ env: <NAME> }\` reference to an environment
variable, so secrets stay out of git; the key is read at run time.

## Inputs

A workflow can declare \`inputs:\` — named parameters collected via a
modal when you click *Run*. One definition can target many things (e.g.
a single \`pr-review\` workflow with a \`pr_number\` input, instead of
one YAML file per PR). Workflows with no \`inputs:\` invoke on a single
click as today.

\`\`\`yaml
name: pr-review
inputs:
  - name: pr_number
    description: GitHub PR to review
    required: true
  - name: branch
    default: main
steps:
  - sh: echo "pr=$PR_NUMBER branch=$BRANCH"
    env:
      PR_NUMBER:
        input: pr_number
      BRANCH:
        input: branch
\`\`\`

- Each input is \`{ name, description?, required?, default?, options? }\`.
  Values are strings.
- \`required: true\` gates the modal's submit until the field is
  non-empty. \`default\` pre-fills the field.
- \`options: [...]\` constrains an input to a fixed list of allowed
  strings — the modal renders a picker, the declared \`default\` (if
  any) must be one of the entries, and values supplied at invoke must
  also be in the list.
- Wire an input into a step / articles / summarise \`env:\` with
  \`{ input: <name> }\` — refs to undeclared inputs fail at load time.
- The resolved input map is snapshotted onto the run, so the feed shows
  what a run was invoked with.

## Named outputs

A main \`sh:\`/\`use:\` step that computes several values can declare
them under \`outputs:\` and emit each by name with the \`kiri-output\`
command, which kiri places on the step's PATH. Later steps, articles,
and summarise pull exactly the value they need with
\`{ step: <id>, output: <name> }\` instead of re-parsing stdout:

\`\`\`yaml
steps:
  - sh: |
      set -eu
      kiri-output url "https://example.com/pr/42"
      kiri-output count "3"
    id: fetch
    outputs: [url, count]
  - sh: 'echo "count=$COUNT url=$URL"'
    env:
      COUNT: { step: fetch, output: count }
      URL: { step: fetch, output: url }
\`\`\`

- Output names match \`^[a-z][a-z0-9_-]*$\` and are unique within the
  step. Declaring \`outputs:\` requires an \`id\` — that's how refs
  address them.
- The declaration is a contract: a step that exits ok without emitting
  every declared name **fails the run**. Refs to undeclared names fail
  at load time, so a consumer's ref always resolves.
- \`kiri-output\` in a step with no \`outputs:\` exits non-zero — under
  \`set -e\` the step fails at the offending line. Emitting an
  undeclared name warns and drops the value; re-emitting a declared
  name overwrites it (last value wins).
- \`llm:\` steps can't declare outputs — a completion's single product
  is its text, referenced whole via \`{ step: <id> }\`.
- Emitted values are shown in the step's expanded row on the run page.

## Recommendations

A workflow's main step can propose follow-up workflow invocations
attached to the producing run. The activity feed marks each run with
a small "N recommendations" count in its byline; the run detail page
surfaces them under a **Recommended** section as trigger buttons that
open the standard invoke modal pre-filled with the proposed inputs.

To emit a recommendation, call \`kiri-recommend\` — a command kiri puts
on every main step's PATH:

\`\`\`sh
kiri-recommend \\
  --workflow "PR Review" \\
  --title "Review pull request owner/repo #42" \\
  --description "<short context>" \\
  --input pr_number=42 --input repo=owner/repo
\`\`\`

- \`--workflow\` and \`--title\` are required; \`--description\` and
  repeatable \`--input key=value\` pairs are optional. Input keys should
  match the target workflow's declared input names.
- A malformed call exits non-zero without writing, so a \`set -eu\`
  script fails at the offending line.
- Available on main \`steps:\` only — not on \`articles:\`, \`summarize:\`,
  or \`llm:\` steps.
- Only \`ok\` steps' recommendations are ingested; failed and cancelled
  steps' are discarded entirely.

Use this when a run *enumerates* things a follow-up could act on —
open PRs, failing tests, queued items — so each enumerated thing
becomes a one-click launch.

## IDE / LSP integration

Kiri writes its JSON Schemas at \`.kiri/workflow.schema.json\` (for
\`workflows/*.yaml\`) and \`.kiri/kiri.schema.json\` (for \`kiri.yaml\`),
refreshing them on every startup, so editor validation and autocomplete
stays in sync after you upgrade kiri.

### VS Code (Red Hat YAML extension)

The simplest setup is a modeline at the top of each file:

\`\`\`yaml
# workflows/*.yaml
# yaml-language-server: $schema=../.kiri/workflow.schema.json

# kiri.yaml
# yaml-language-server: $schema=.kiri/kiri.schema.json
\`\`\`

Or configure \`yaml.schemas\` in your workspace \`.vscode/settings.json\`:

\`\`\`json
{
  "yaml.schemas": {
    ".kiri/workflow.schema.json": "workflows/*.yaml",
    ".kiri/kiri.schema.json": "kiri.yaml"
  }
}
\`\`\`

### JetBrains IDEs

Settings → Languages & Frameworks → Schemas and DTDs → JSON Schema Mappings.
Map \`.kiri/workflow.schema.json\` to \`workflows/*.yaml\` and
\`.kiri/kiri.schema.json\` to \`kiri.yaml\`.

## Re-running \`kiri init\`

Safe — existing files are never overwritten; only the schema is refreshed.
`;

/** Contents of the scaffolded `workflows/hello-world.yaml`. */
export const HELLO_WORLD_WORKFLOW = `# yaml-language-server: $schema=../.kiri/workflow.schema.json

name: Hello World
description: A starter workflow — greets whoever you name when you run it.

inputs:
  - name: name
    description: Who to greet — try your name, or a project name.
    required: true

steps:
  - sh: |
      echo "\${GREETING}, \${NAME}."
      echo "Edit workflows/hello-world.yaml or drop new workflows alongside it."
    name: Greet
    description: A one-step workflow. Trigger it from the activity feed.
    env:
      GREETING: Hello
      NAME: { input: name }
`;

/**
 * Contents of the scaffolded `kiri.yaml`. Fully commented — a workspace with no
 * `llm:` steps needs no providers, and an empty/comment-only file loads as "no
 * config". Uncomment to declare providers.
 */
export const DEFAULT_KIRI_CONFIG = `# yaml-language-server: $schema=.kiri/kiri.schema.json

# kiri.yaml — kiri's workspace configuration.
#
# Declare the LLM providers your \`llm:\` workflow steps and agentic chat
# sessions use, under \`providers:\`. You only need this if you use them.
# Reference a provider as \`provider:model\` (e.g. \`anthropic:claude-haiku-4-5\`).
# An API key is ALWAYS a \`{ env: <NAME> }\` reference — never a literal — so
# secrets stay out of git. Uncomment and edit to get started:
#
# providers:
#   anthropic:
#     type: anthropic
#     api_key:
#       env: ANTHROPIC_API_KEY
#   local:
#     type: openai-compatible          # LM Studio, Ollama, vLLM, …
#     base_url: http://localhost:1234/v1
#
# Pin your favourite models and size delegated work under \`models:\`.
# \`shortcuts\` are free-form names hoisted to the top of the session
# pickers, in config order — the first is the default for new sessions.
# \`delegates\` map the worker sizes the assistant picks between when it
# delegates — quick (mechanical legwork), daily (ordinary work), deep
# (reasoning-heavy) — configure any subset; with none, workers run the
# delegating session's model. \`utility\` is the model kiri itself uses for
# small internal generations — naming a new session, judging shell
# commands under the Auto permission — point it at a fast, cheap model (a
# local one works well); unset, titling runs on the session's own model
# and Auto falls back to asking:
#
# models:
#   shortcuts:
#     text:
#       sonnet: anthropic:claude-sonnet-4-5
#       haiku: anthropic:claude-haiku-4-5
#     image:
#       images: openai:gpt-image-1
#   delegates:
#     quick: anthropic:claude-haiku-4-5
#     daily: anthropic:claude-sonnet-4-5
#     deep: anthropic:claude-opus-4-5
#   utility: anthropic:claude-haiku-4-5
#
# Give agentic chat sessions tools from MCP servers, under \`mcp:\`. A remote
# \`http\` server signs in with OAuth (\`auth: oauth\` — kiri runs the browser
# flow and stores the tokens) or a static header (an \`{ env: <NAME> }\` ref);
# a local \`stdio\` server is a command kiri spawns. Uncomment to get started:
#
# mcp:
#   tavily:                            # web search — sign in from the app
#     type: http
#     url: https://mcp.tavily.com/mcp/
#     auth: oauth
#   memory:
#     type: stdio
#     command: npx
#     args: ["-y", "@modelcontextprotocol/server-memory"]
#
# Give sessions first-party tools to find, read, search, and change
# files — and run shell commands (builds, tests, git) — by declaring
# \`filesystem:\` with the directories they may work in; without it none
# of those tools are offered at all (reads run freely; writes, edits,
# deletes, and every command ask first). "." is the workspace root and
# a leading ~ expands to your home directory. Sessions start working in
# \`default_working_directory\` (or the first allowed directory when it
# is unset) and can move themselves anywhere inside the sandbox:
#
# filesystem:
#   allowed_directories:
#     - .
#     - ~/notes
#   default_working_directory: .
`;

/** Relative paths reported by `initRepo`. */
const SCHEMA_REL_PATH = ".kiri/workflow.schema.json";
const CONFIG_SCHEMA_REL_PATH = ".kiri/kiri.schema.json";
const CONFIG_REL_PATH = "kiri.yaml";
const README_REL_PATH = "README.md";
const HELLO_WORLD_WORKFLOW_REL_PATH = "workflows/hello-world.yaml";
const GITIGNORE_REL_PATH = ".gitignore";
const GITIGNORE_KIRI_LINE = ".kiri/";

/** Structured summary of what `initRepo` did, suitable for logging by the CLI. */
export interface InitResult {
  /** Repo-relative paths of files newly written. */
  created: string[];
  /** Repo-relative paths of files that already existed and were left untouched. */
  skipped: string[];
  /** Repo-relative path of the workflow schema file (always (re)written). */
  schemaPath: string;
  /** Repo-relative path of the kiri.yaml config schema file (always (re)written). */
  configSchemaPath: string;
  /** True if `.gitignore` was created or appended to add the `.kiri/` line. */
  gitignoreUpdated: boolean;
}

/**
 * (Re)write `.kiri/workflow.schema.json` from the live Zod schema. Called by
 * both `initRepo` and on every kiri startup so the schema file stays in sync
 * after a binary upgrade — no need to re-run `init` to refresh it.
 */
export function writeSchemaFile(config: ConfigStore): string {
  const dir = config.dataDir();
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "workflow.schema.json");
  writeFileSync(path, `${JSON.stringify(workflowJsonSchema(), null, 2)}\n`);
  return path;
}

/**
 * (Re)write `.kiri/kiri.schema.json` from the live Zod schema, so editor
 * validation of `kiri.yaml` stays in sync after a binary upgrade. Written on
 * every startup alongside the workflow schema.
 */
export function writeKiriConfigSchemaFile(config: ConfigStore): string {
  const dir = config.dataDir();
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "kiri.schema.json");
  writeFileSync(path, `${JSON.stringify(kiriConfigJsonSchema(), null, 2)}\n`);
  return path;
}

/**
 * Write a commented default `kiri.yaml` when the workspace has no config file
 * yet (neither `kiri.yaml` nor `kiri.yml`). Never overwrites an existing one.
 * Returns true if it created the file. Called on every launch so a fresh
 * workspace gets a self-documenting config skeleton with no `kiri init` step.
 */
export function writeDefaultConfig(config: ConfigStore): boolean {
  if (config.configFiles().some((path) => existsSync(path))) return false;
  writeFileSync(config.configFile(), DEFAULT_KIRI_CONFIG);
  return true;
}

const writeIfMissing = (
  absPath: string,
  relPath: string,
  contents: string,
  created: string[],
  skipped: string[],
): void => {
  if (existsSync(absPath)) {
    skipped.push(relPath);
    return;
  }
  writeFileSync(absPath, contents);
  created.push(relPath);
};

const ensureKiriIgnored = (config: ConfigStore): boolean => {
  const path = join(config.cwd(), GITIGNORE_REL_PATH);
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
 * Bootstrap a kiri-ready workspace: create `workflows/`, drop in a repo
 * README, a minimal hello-world starter workflow, and a commented `kiri.yaml`,
 * (re)write the workflow and kiri.yaml JSON Schema files, and add `.kiri/` to
 * `.gitignore` if one exists. User-authored files are never overwritten — only
 * missing files are created. The schema files are always refreshed.
 */
export function initRepo(config: ConfigStore): InitResult {
  const workflowsDir = config.workflowsDir();
  mkdirSync(workflowsDir, { recursive: true });

  const created: string[] = [];
  const skipped: string[] = [];

  writeIfMissing(join(config.cwd(), "README.md"), README_REL_PATH, KIRI_README, created, skipped);
  writeIfMissing(
    join(workflowsDir, "hello-world.yaml"),
    HELLO_WORLD_WORKFLOW_REL_PATH,
    HELLO_WORLD_WORKFLOW,
    created,
    skipped,
  );
  (writeDefaultConfig(config) ? created : skipped).push(CONFIG_REL_PATH);

  writeSchemaFile(config);
  writeKiriConfigSchemaFile(config);
  const gitignoreUpdated = ensureKiriIgnored(config);

  return {
    created,
    skipped,
    schemaPath: SCHEMA_REL_PATH,
    configSchemaPath: CONFIG_SCHEMA_REL_PATH,
    gitignoreUpdated,
  };
}
