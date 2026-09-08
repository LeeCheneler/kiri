import { type HostEnvironment, describeHost } from "./host-environment.ts";

// The host-specific shell rules for the guide's environment section. A
// model's training prior is GNU/Linux shell, so the darwin branch spells out
// the BSD divergences that actually break scripts; the linux branch mirrors
// it for BSD-isms; anything else gets a verify-first fallback.
const hostShellRules = (host: HostEnvironment): string => {
  if (host.platform === "darwin") {
    return `This machine is **${describeHost(host)}**. Write every
script for macOS — generic-Linux shell fails here. The traps:

- \`sed -i\` needs an explicit backup-suffix argument on BSD sed: write
  \`sed -i ''\` (bare GNU-style \`-i\` is an error).
- \`date\` has no \`-d\`/\`--date\`: use \`date -v-1d\` for offsets and
  \`date -j -f '<fmt>' '<value>'\` for parsing.
- \`grep\` has no \`-P\`: use \`-E\` with POSIX classes instead of PCRE.
- \`stat\` takes \`-f\` format strings (GNU \`-c\` fails); \`timeout\`, \`tac\`,
  and \`nproc\` don't exist; GNU-only long options (\`--color\`,
  \`--sort=size\`, …) are generally absent from BSD tools.
- No \`apt\`, \`systemctl\`, or \`/proc\` — those are Linux-only.`;
  }
  if (host.platform === "linux") {
    return `This machine is **${describeHost(host)}**. Write every
script for Linux with GNU tools — don't use BSD/macOS forms:

- \`sed -i ''\` is a BSD-ism — GNU sed takes bare \`sed -i\`.
- \`date -v\`, \`stat -f\`, \`pbcopy\`, \`open\`, and \`defaults\` are macOS-only.`;
  }
  return `This machine reports platform \`${host.platform}\` (${host.release}, ${host.arch}).
Verify any platform-specific flag against this system before relying on it,
and prefer portable POSIX forms.`;
};

/**
 * Build the workflow-authoring reference served as the first-party
 * `workflow-authoring` skill, tailored to the host the workflows will run
 * on. Loaded into a conversation once, on demand, before the model's first
 * authoring call — kept out of the system prompt so sessions that never
 * author workflows don't pay for it. Covers the YAML contract, execution
 * model, host environment, and supporting files. File and command operations
 * are conditional on available capabilities and their permission boundaries.
 */
export const buildWorkflowAuthoringGuide = (host: HostEnvironment): string =>
  `# Kiri workflow authoring guide

Kiri supports general-purpose and coding sessions; workflows are an optional way
to automate a repeatable task. Only create a workflow when the user explicitly
requests one. Repetition alone, a wish to keep a result, or an unanswered offer
is not authorization. Loading this guide is not authorization either.
A workflow is a **linear pipeline** defined in one YAML file. Every phase gets
empty stdin; declared env refs carry data between steps. Optional \`articles:\` turn output into
saved markdown documents, and an optional \`summarize:\` step writes the run's
feed summary. The user runs workflows on demand from kiri's catalog (or asks
you to, via run_workflow when available). The workflow write tools validate
YAML and its referenced dependencies before saving. Direct filesystem or
shell writes do not pass through that validation gate.

## Available capabilities

Use only tools offered in the current turn and respect their permissions,
applicable standing instructions, and allowed paths. Loading this guide does
not enable tools or authorize writes or execution. If a named tool is absent,
use an available equivalent only within the task's authorization; otherwise
ask for the missing input or explain the limitation.

Prefer the validated workflow tools for YAML. Supporting bundle scripts and
prompt templates are separate files, created only when an available file-writing
or command tool can reach their paths inside the workspace. A session's current
working directory may be a different project; resolve dependencies against the
workflow workspace, not that directory. If those capabilities are unavailable,
use inspected existing bundles and inline prompts, or explain what the user
needs to provide.

## Host environment — scripts run on THIS machine

Workflow steps execute directly on the user's machine, never in a container,
VM, or Linux CI image. ${hostShellRules(host)}

On any host:

- \`sh:\` scripts run via \`sh -c\`, and \`sh\` is not bash: write POSIX sh —
  no arrays, no \`[[ ]]\`, no \`set -o pipefail\`, no process substitution.
- Don't assume optional CLIs (\`jq\`, \`gh\`, …) are installed: PATH is the
  user's own, so tools they use exist, but prefer commands an existing
  workflow already uses before reaching for an exotic one.

## The file

\`\`\`yaml
# yaml-language-server: $schema=../.kiri/workflow.schema.json

name: PR Review              # required — unique across the workspace
description: Reviews a PR    # optional — one-line deck under the title
group: Dev                   # optional — buckets the workflow in the catalog

inputs:                      # optional — parameters collected when a run starts
  - name: pr_number          # ^[a-z_][a-z0-9_]*$, unique
    description: PR to review
    required: true
  - name: model
    options: [haiku, sonnet] # constrains to a picker; values are always strings
    default: sonnet          # with options:, default must be one of them

steps:                       # required, at least one
  - sh: |                    # inline shell (run via sh -c)
      set -eu
      gh pr view "$PR_NUMBER" --json title,body,files
    id: fetch                # optional — lets later phases reference this stdout
    name: Fetch the PR       # optional — the step's label in the UI
    env:
      PR_NUMBER:
        input: pr_number     # value of the declared input

  - llm:                     # first-party model completion (no process spawned)
      model: anthropic:claude-haiku-4-5   # provider:model — provider must be configured
      prompt: |
        Review this pull request:

        {{PR}}
    name: Review
    id: review
    env:
      PR:
        step: fetch          # refs render into the prompt under the name you give them

articles:                    # optional — saved markdown documents, run after all steps pass
  - slug: review             # ^[a-z0-9-]+$, unique within the workflow
    name: PR Review          # series label (feed chip + page eyebrow)
    llm:
      model: anthropic:claude-haiku-4-5
      prompt: "Format this review as a markdown document with a # headline: {{REVIEW}}"
    env:
      REVIEW:
        step: review         # articles get EMPTY stdin — data arrives via refs

summarize:                   # optional — one-shot feed summary, best-effort
  llm:
    model: anthropic:claude-haiku-4-5
    prompt: "One feed sentence on this review: {{REVIEW}}"
  env:
    REVIEW:
      step: review
\`\`\`

## Steps

A step is **exactly one** of three shapes (mixing them in one step is an error):

- \`sh: <script>\` — inline shell via \`sh -c\`. Use a \`|\` block scalar for
  multi-line scripts, and start every non-trivial one with \`set -eu\` —
  without it, sh does not stop on the first failure. Write it for the host
  environment above: POSIX sh, this machine's tools and flags.
- \`use: <bundle>\` — runs \`bundles/<bundle>/run.sh\` from the workspace.
  Inspect the bundle's script and README when readable, or use a verified
  existing workflow's env contract. Do not invent a bundle name or contract.
  A new bundle must exist before the workflow write can validate it; create
  one only with the supporting-file capabilities described below. Otherwise
  compose from \`sh:\` and \`llm:\` or use an inspected existing bundle.
- \`llm: { model, prompt | prompt_file }\` — a first-party model completion,
  in-process. The completion text is the step's stdout. Use \`llm:\` when a
  step just needs text from a model; use a bundle (e.g. one that spawns an
  agent CLI) when the step must *do* things — run tools, touch files.

Any step may also set:

- \`id\` — \`^[a-z][a-z0-9_-]*$\`, unique in the workflow. Only steps with an
  \`id\` can be referenced by later phases via \`{ step: <id> }\`.
- \`name\` — short human label for the run timeline (defaults to the bundle
  name, the script's first line, or the model id). Always set it on
  multi-line \`sh:\` steps so the UI shows a label, not code.
- \`description\` — longer detail, shown when the step row is expanded.
- \`outputs\` — \`sh:\`/\`use:\` steps only; requires an \`id\`. Named values
  the step promises to emit via \`kiri-output <name> <value>\` (on PATH).
  A step exiting ok without emitting every declared name **fails**, so
  refs to outputs always resolve.

## Supporting files

When available tools and allowed paths permit a new bundle, write
\`bundles/<name>/run.sh\` with a suitable shebang and a README documenting
required/optional env vars and output. Kiri starts run.sh directly: it must
be executable. \`write_file\` creates text files but does not set executable
permissions. With \`run_command\` available, a targeted \`chmod +x\` on the
new script can set that bit through the normal command approval gate. Without
an available way to set it, ask the user to do so or keep the script inline
as \`sh:\`; do not claim the bundle is runnable. Existing executable scripts
retain their mode when edited with the file tools.

Prompt templates (for example \`prompts/review.tpl\`) need no executable bit.
Inspect or create supporting files before referencing them, and verify their
paths and contents with available reads. Workflow validation checks dependency
existence, not script correctness or executable permissions. File and command
writes have their own approval gates and instruction checks; never use them
to bypass a denied workflow operation. Tests or executions still require the
user's task to authorize them.

## Data flow

- **Every phase gets empty stdin.** Data moves between phases only through
  env refs: give the producing step an \`id\`, and pull its stdout anywhere
  later with a \`{ step: <id> }\` env ref — byte-for-byte, never truncated.
- A step computing **several values** should declare \`outputs:\` and emit
  each with \`kiri-output\`; consumers pull one value with
  \`{ step: <id>, output: <name> }\` instead of re-parsing stdout. Prefer
  this over ad-hoc JSON-on-stdout when more than one downstream value is
  needed.
- \`articles:\` and \`summarize:\` follow the same rule: they receive exactly
  the data they declare through env refs — a phase expecting piped stdin is
  the most common authoring mistake, nothing arrives that way.
- Runs are **fail-fast**: a failing step halts the pipeline, skips articles
  and summarize, and marks the run failed. A failing article entry does the
  same for what remains. Only a failing summariser is non-fatal.

## env: rules (these bite — read carefully)

Steps run with a **scoped env**. Nothing from the user's shell is inherited
except \`PATH\`, \`HOME\`, \`USER\`, \`LOGNAME\` — so CLIs that carry their own
auth (\`gh\`, \`claude\`) work, but a parent-shell \`MY_TOKEN\` does not exist
unless the step declares it.

- \`env:\` is a flat map. Every value is a **string literal** or a ref:
  \`{ input: <name> }\`, \`{ step: <id> }\`, \`{ step: <id>, output: <name> }\`,
  \`{ article: <slug> }\`, \`{ env: <NAME> }\`.
- **Strings only.** Quote numbers and booleans: \`MAX_TURNS: "50"\`.
- **Keys starting with \`KIRI_\` are rejected** — reserved namespace.
- The ref graph is validated when the file loads: unknown names, unknown ids,
  refs to undeclared output names, self- and forward-references are all
  errors. Refs are **backward-only**.
- \`{ article: <slug> }\` is only valid on \`articles:\` entries (earlier
  siblings only) and \`summarize:\` — never on a main step.
- **Secrets never go in the YAML as literals** (workflow files live in git).
  Hand a step a secret with \`{ env: <NAME> }\` — it resolves at spawn from
  the kiri process environment (the workspace \`.env\` or the shell kiri was
  launched from) under the key you give it. The variable must be set when
  the file loads, or the workflow is rejected naming it — so if the user
  hasn't confirmed it exists, ask before writing the ref. Otherwise prefer
  CLIs with their own auth.
- A step's working directory is a per-run scratch dir, **not** the repo root
  — scripts resolve repo paths against \`$KIRI_REPO_ROOT\`.
- Treat external text (PR titles, fetched pages, model output) as untrusted:
  pass it between steps through declared env refs, never spliced into a shell
  command string. Inside a script, pass values to commands through quoted argv,
  environment variables, or an explicit pipe.

Kiri injects \`KIRI_RUN_ID\`, \`KIRI_STEP_INDEX\`, and \`KIRI_REPO_ROOT\` into
every step; \`KIRI_BUNDLE_DIR\` into \`use:\` steps;
\`KIRI_RECOMMENDATIONS_FILE\` into main \`sh:\` / \`use:\` steps only; and
\`KIRI_OUTPUTS_FILE\` only into steps declaring \`outputs:\` (write through
\`kiri-output\`, not the file directly).

## llm: steps

- A configured \`openai-codex\` provider works for \`llm:\` steps through the user's Codex CLI login. Use its listed model IDs; on expired or rejected authentication, tell the user to run \`codex login\` and retry. Never read or copy credential files into a workflow.
- \`model\` is \`provider:model\` — the prefix must name a provider configured
  in the workspace's kiri.yaml. **Never invent one.** Use, in order: a model
  the user's standing instructions name as preferred for workflows, a
  \`provider:model\` already used by an existing workflow (read one), or —
  when neither exists — ask the user which provider and model to use before
  authoring the \`llm:\` step. An unknown provider is rejected by validation
  (the rejection names the configured providers); an invented model id would
  only fail later, at run time.
- Exactly **one** of \`prompt\` / \`prompt_file\` on every llm entry — steps,
  articles, and summarize alike. \`prompt_file\` resolves against the workspace
  root and must exist before the workflow write validates. Create it only
  with available, permitted file-writing or command tools; otherwise use an
  inline \`prompt:\` block or an inspected existing template.
- Prompts are templates: \`{{VAR}}\` placeholders substitute from the step's
  env in one pass (unknown vars become empty; values are not re-scanned).
  Upstream data arrives only through refs: declare \`DATA: { step: x }\` and
  template \`{{DATA}}\`.
- An \`llm:\` step cannot emit recommendations or declare \`outputs:\` — no
  file channels; its single product is the completion text.

## articles: — saved markdown documents

- Run serially after **every** step completes ok; each entry's trimmed
  stdout is stored as a markdown article and rendered on its own page.
- Structure the output as a document: open with a single \`# Headline\`
  (anything before it is dropped; no "Here's the article" chatter), then
  \`##\` sections — they become the page's table of contents. The entry's
  \`name\` is the recurring series label; the body headline names the edition.
- Articles may embed charts and diagrams: a fenced \`chart\` block holding a
  Vega-Lite JSON spec with **inline data only** (\`data.values\`, remote URLs
  are rejected), \`"width": "container"\` plus a numeric \`"height"\`; and a
  fenced \`mermaid\` block for flowcharts/sequence/state/ER diagrams. Theming
  is automatic in both — don't hand-pick colours. Malformed specs degrade to
  an inline notice without breaking the article.

## summarize: — the feed summary

- One \`sh:\` / \`use:\` / \`llm:\` step, run last, only on a fully-ok run. Its
  trimmed stdout becomes the run's summary on the activity feed. Failure
  here never fails the run. It cannot declare an \`id\` or \`outputs\`.
- Like every phase, it declares its data with refs — usually a named output
  or an article: \`COUNT: { step: scan, output: count }\` into a one-line
  \`sh:\` echo, or \`REVIEW: { article: review }\` templated into a short llm
  prompt. Keep the ref narrow: pass the value or document the summary is
  about, not every upstream blob.

## Recommendations (advanced)

A main \`sh:\` / \`use:\` step that *enumerates* actionable things (open PRs,
failing checks) can propose one-click follow-ups. Emit each with the
\`kiri-recommend\` command (on PATH inside every main step):

\`\`\`sh
kiri-recommend --workflow "PR Review" --title "Review owner/repo #42" \\
  --description "fix the thing (by @lee)" --input pr_number=42 --input repo=owner/repo
\`\`\`

\`--workflow\` names another workflow; \`--input\` keys match its declared
inputs. A malformed call exits non-zero, failing a \`set -eu\` step at that
line. Put the distinguishing detail (repo, number) in \`--title\` so entries
stay scannable in a mixed feed.

## Working method

1. **Read before writing.** Call list_workflows, then read_workflow on the
   closest existing workflow — match the workspace's naming, grouping, and
   step style rather than inventing your own.
2. Start files with \`# yaml-language-server: $schema=../.kiri/workflow.schema.json\`
   so the user's editor validates them too.
3. Keep it simple: the fewest steps that do the job, \`set -eu\` in shell,
   named steps, a \`description:\` and (when the workspace uses them) a
   \`group:\`. Parameterise with \`inputs:\` only what genuinely varies per run.
4. Prefer edit_workflow (exact-string replacement, old_string taken from
   read_workflow's output) over replace_workflow; replace only for wholesale
   rewrites. create_workflow's slug should be the kebab-case of the name.
5. Workflow-tool writes are validated first — YAML parse, schema, bundle existence,
   llm provider, prompt files. Within an authorized authoring task, correct a
   validation error and retry. A permission denial is different: do not retry
   it or bypass it through another tool.
6. A saved workflow appears in the catalog immediately (no restart, no run
   needed to "activate" it). Run it only when the user wants it executed.
7. Within an authorized fix or test task, diagnose the failure, correct its
   cause, and continue safe test iterations. Creating a workflow alone does
   not authorize running it. A request merely to run or inspect an existing
   workflow does not authorize changing its definition.
8. Before re-execution, inspect what completed: failure or timeout does not
   prove earlier actions had no effects. Do not blindly repeat sending,
   publishing, charging, deleting, or other external effects. If prior effects
   or permission to repeat are unclear, ask before re-execution.
9. Use run_workflow for the first test and, when available, rerun_workflow with
   that run_id for authorized repeats. It replaces the previous results in the
   same feed entry and re-executes the whole current workflow, not just the
   failed step. Re-supply required inputs; they are not carried over. Tool
   approval gates still apply to every call. If the needed execution tool is
   unavailable, report the limit rather than claiming the workflow was tested.
`;
