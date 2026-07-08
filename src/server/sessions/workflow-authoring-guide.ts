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
 * Build the workflow-authoring reference served by the
 * `read_workflow_authoring_guide` session tool, tailored to the host the
 * workflows will run on. Loaded into a conversation once, on demand, before
 * the model's first authoring call — kept out of the system prompt so
 * sessions that never author workflows don't pay for it. Content is scoped
 * to what a session can do through the workflow tools: it teaches the YAML
 * contract, the execution model, the host environment scripts must target,
 * and the working method, but not filesystem-side authoring (bundles, prompt
 * files, kiri.yaml) that sessions have no tools for.
 */
export const buildWorkflowAuthoringGuide = (host: HostEnvironment): string =>
  `# Kiri workflow authoring guide

You are authoring workflows for kiri: a local-first personal automation tool.
A workflow is a **linear pipeline** defined in one YAML file: each step's
stdout becomes the next step's stdin, optional \`articles:\` turn output into
saved markdown documents, and an optional \`summarize:\` step writes the run's
feed summary. The user runs workflows on demand from kiri's catalog (or asks
you to, via run_workflow). Everything in this guide is enforced by a
validation gate: nothing invalid ever reaches disk, and a rejected write
tells you exactly what to fix — fix it and retry.

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

        {{KIRI_INPUT}}
    name: Review

articles:                    # optional — saved markdown documents, run after all steps pass
  - slug: review             # ^[a-z0-9-]+$, unique within the workflow
    name: PR Review          # series label (feed chip + page eyebrow)
    llm:
      model: anthropic:claude-haiku-4-5
      prompt: "Format this review as a markdown document with a # headline: {{REVIEW}}"
    env:
      REVIEW:
        step: fetch          # articles get EMPTY stdin — data arrives via refs

summarize:                   # optional — one-shot feed summary, best-effort
  llm:
    model: anthropic:claude-haiku-4-5   # no prompt = built-in summary prompt
\`\`\`

## Steps

A step is **exactly one** of three shapes (mixing them in one step is an error):

- \`sh: <script>\` — inline shell via \`sh -c\`. Use a \`|\` block scalar for
  multi-line scripts, and start every non-trivial one with \`set -eu\` —
  without it, sh does not stop on the first failure. Write it for the host
  environment above: POSIX sh, this machine's tools and flags.
- \`use: <bundle>\` — runs \`bundles/<bundle>/run.sh\` from the workspace. Only
  reference a bundle you have seen used in an existing workflow, and copy its
  \`env:\` contract from that usage — an unknown bundle is rejected, and you
  cannot create bundles from a session. When no bundle fits, compose from
  \`sh:\` and \`llm:\` instead.
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

## Data flow

- \`steps[0]\` gets empty stdin; every later step gets the previous step's
  **full stdout** on stdin. Adjacent data can just flow down the pipe.
- Non-adjacent data uses refs: give the producing step an \`id\`, and pull its
  stdout anywhere later with a \`{ step: <id> }\` env ref — byte-for-byte,
  never truncated.
- \`articles:\` entries and \`summarize:\` get **empty stdin**. They receive
  exactly the data they declare through env refs — an articles entry
  expecting piped input is the most common authoring mistake.
- Runs are **fail-fast**: a failing step halts the pipeline, skips articles
  and summarize, and marks the run failed. A failing article entry does the
  same for what remains. Only a failing summariser is non-fatal.

## env: rules (these bite — read carefully)

Steps run with a **scoped env**. Nothing from the user's shell is inherited
except \`PATH\`, \`HOME\`, \`USER\`, \`LOGNAME\` — so CLIs that carry their own
auth (\`gh\`, \`claude\`) work, but a parent-shell \`MY_TOKEN\` does not exist
unless the step declares it.

- \`env:\` is a flat map. Every value is a **string literal** or one of three
  refs: \`{ input: <name> }\`, \`{ step: <id> }\`, \`{ article: <slug> }\`.
- **Strings only.** Quote numbers and booleans: \`MAX_TURNS: "50"\`.
- **Keys starting with \`KIRI_\` are rejected** — reserved namespace.
- The ref graph is validated when the file loads: unknown names, unknown ids,
  self- and forward-references are all errors. Refs are **backward-only**.
- \`{ article: <slug> }\` is only valid on \`articles:\` entries (earlier
  siblings only) and \`summarize:\` — never on a main step.
- **Secrets never go in the YAML as literals** (workflow files live in git).
  Prefer CLIs with their own auth, or have the script read a mode-600 file.
- A step's working directory is a per-run scratch dir, **not** the repo root
  — scripts resolve repo paths against \`$KIRI_REPO_ROOT\`.
- Treat external text (PR titles, fetched pages, model output) as untrusted:
  pass it between steps via stdin or env vars, never spliced into a shell
  command string.

Kiri injects \`KIRI_RUN_ID\`, \`KIRI_STEP_INDEX\`, and \`KIRI_REPO_ROOT\` into
every step; \`KIRI_BUNDLE_DIR\` into \`use:\` steps; \`KIRI_SUMMARY_CONTEXT\`
into \`summarize:\` only; and \`KIRI_RECOMMENDATIONS_FILE\` into main \`sh:\` /
\`use:\` steps only.

## llm: steps

- \`model\` is \`provider:model\` — the prefix must name a provider configured
  in the workspace's kiri.yaml. **Never invent one.** Use, in order: a model
  the user's standing instructions name as preferred for workflows, a
  \`provider:model\` already used by an existing workflow (read one), or —
  when neither exists — ask the user which provider and model to use before
  authoring the \`llm:\` step. An unknown provider is rejected by validation
  (the rejection names the configured providers); an invented model id would
  only fail later, at run time.
- Exactly **one** of \`prompt\` / \`prompt_file\` on steps and articles.
  \`prompt_file\` must already exist in the workspace — you cannot create
  prompt files from a session, so default to an inline \`prompt:\` block.
- Prompts are templates: \`{{VAR}}\` placeholders substitute from the step's
  env in one pass (unknown vars become empty; values are not re-scanned).
  \`{{KIRI_INPUT}}\` is the previous step's stdout (pipeline steps only —
  it is empty in articles, which must use refs: declare \`DATA: { step: x }\`
  and template \`{{DATA}}\`).
- An \`llm:\` step cannot emit recommendations — no file channels.

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
  here never fails the run. It cannot declare an \`id\`.
- Every summariser receives \`KIRI_SUMMARY_CONTEXT\`: a prompt-ready digest of
  the whole run (step outputs and article bodies, each capped at 64 KB). A
  shell summariser reads \`$KIRI_SUMMARY_CONTEXT\`; an llm prompt templates
  \`{{KIRI_SUMMARY_CONTEXT}}\`. The digest is the lossy gist plane — when a
  summariser needs full-fidelity output, take it through a ref instead.
- \`summarize: { llm: { model } }\` with no prompt is the zero-config default
  and is right for most workflows.

## Recommendations (advanced)

A main \`sh:\` / \`use:\` step that *enumerates* actionable things (open PRs,
failing checks) can propose one-click follow-ups: append JSON Lines to
\`$KIRI_RECOMMENDATIONS_FILE\`, one \`{ "title", "workflow", "description"?,
"inputs"? }\` object per line, where \`workflow\` names another workflow and
\`inputs\` matches its declared inputs. Put the distinguishing detail (repo,
number) in \`title\` so entries stay scannable in a mixed feed.

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
5. Every write is validated first — YAML parse, schema, bundle existence,
   llm provider, prompt files. A rejection names the problem: correct the
   YAML and retry rather than giving up or asking the user to fix it.
6. A saved workflow appears in the catalog immediately (no restart, no run
   needed to "activate" it). Run it only when the user wants it executed.
7. When you do test a workflow across edits, call run_workflow once, then
   re-execute with rerun_workflow (same run_id) after each fix — every
   attempt replaces the same activity-feed entry instead of adding one, and
   the workflow's current file is what runs each time.
`;
