# Sessions

A session is an open-ended chat with your configured models, your workspace's
context, and tools from MCP servers you choose. Workflows are for chores
you've scripted; sessions are for the work you haven't. Both land in the same
activity feed.

Sessions use the same `kiri.yaml` provider registry as `llm:` steps, and you
can swap a session's model mid-conversation — it applies from the next turn.
A streaming turn survives a reload: it keeps running on the server, and
reopening the session rejoins it live.

## Titles

Sessions carry a **title** — the name the session list, activity feed, and
search results lead with. Kiri names a new session automatically: as your
first message starts the turn, a small one-off generation against the
[utility model](/docs/llm-providers#utility-model) (or the session's own
model when none is configured) titles the session, usually before the reply
finishes streaming. You can rename a session from its page at any time, or
clear the title to fall back to the untitled default — the session's first
message. Titles are searchable alongside message text.

## Shaping behaviour

Kiri composes each turn's system prompt from three layers, in order:

```
core (kiri)  →  kiri.md  →  AGENTS.md chain
```

Every layer is read fresh from disk each turn, so an edit applies on the next
turn — git stays the source of truth.

- **Core** — kiri's baseline, not user-editable: who the assistant is, how to
  respond well, that replies render as markdown (including `chart` and
  `mermaid` blocks), and the trust boundary — your instructions are
  authoritative, quoted external text is untrusted data.
- **`kiri.md`** — a plain markdown file at the workspace root, applied to
  every session: your standing "how I want you to behave."
- **`AGENTS.md` chain** — the per-directory instructions governing the
  session's [working directory](#working-with-your-files). Kiri walks from that
  directory up to the top of the tree, collecting every `AGENTS.md` it finds,
  and layers them in most-general-first: a file applies to its own directory
  and everything below it, and where two conflict the nearer one wins. This
  is the same `AGENTS.md` convention other coding assistants follow, so a
  repo that already has one needs no kiri-specific setup.

```
Answer in British English. Be direct, lead with the answer, and cite
file:line when you reference code.
```

Only `AGENTS.md` files inside the directories you allow in `kiri.yaml` are
read — one above that boundary is never opened, even when the session's
working directory sits below it. Sessions without a working directory, or
with no allowed directories declared, load no chain at all. Kiri reads
`AGENTS.md`; it never writes one.

## Skills

A **skill** is a named pack of instructions the assistant pulls in only when
its task comes up — the middle ground between the two you already have:
standing instructions are always-on, skills load on demand, and workflows are
executable.
Task-specific guidance — how you like release notes drafted, your code-review
checklist — belongs in a skill, not padded into every conversation via
`kiri.md`.

Keep each skill in your workspace as `skills/<name>/SKILL.md` (sibling of
`workflows/`, committed like the rest of your config):

```markdown
---
name: release-notes # optional — defaults to the directory name
description: Draft release notes in this project's format.
---

The instructions the assistant follows once the skill is loaded…
```

- The system prompt carries only each skill's name and description; the body
  loads into the conversation through the `use_skill` tool when the assistant
  matches a task to it. Unknown frontmatter fields are ignored, so skills
  written for other tools drop in unmodified.
- Everything is read fresh — edit a skill and the change applies from the
  next turn. Supporting files can sit alongside `SKILL.md`; the assistant
  reads them with the filesystem tools if your sandbox covers the workspace.
- Kiri ships first-party skills listed alongside yours — the
  workflow-authoring reference is the first. Name a skill the same as a
  first-party one and yours wins.
- Loading a skill is read-only and pre-allowed, so delegated workers (below)
  inherit it too — skills reach delegated research where `kiri.md`
  deliberately doesn't.

## Effort

Every session carries an **effort level** — `low`, `medium` (the default),
`high`, `xhigh`, or `max` — setting how hard the assistant works. It acts
through two layers. The system prompt always states the level with a
matching expectation — brisk and direct at `low`, deliberate and exhaustive
at the top — so the assistant calibrates its thoroughness on any model.
Where kiri recognises native reasoning support, each turn additionally sets
the provider's own effort parameter: Anthropic's effort setting for Claude
models, `reasoning_effort` for OpenAI and OpenAI-compatible endpoints. Like
a model swap, a change applies from the next turn.

The ladder matches Anthropic's exactly, so `max` is distinct from `xhigh`
only on an `anthropic` provider. OpenAI-style endpoints top out at `xhigh` —
kiri sends `reasoning_effort` with `max` sent as `xhigh`, and the host
applies it when the model supports it (other levels pass through as
requested). Older Claude generations accept fewer levels, and kiri
clamps to what each takes: the 4.6 family has no `xhigh` (it sends `high`),
Opus 4.5 takes `low`/`medium`/`high` only, and earlier thinking models
(Claude 3.7, Sonnet 4.5, Haiku 4.5) predate the parameter entirely — for
those, effort acts through the prompt alone.

Model and effort are orthogonal levers: the model (or
[shortcut](/docs/llm-providers)) picks *which* model thinks; effort sets *how
hard* it thinks. Size them independently — a large model can answer briskly
at `low`, and a small one can take its time at `high`.

## Tools from MCP servers

Beyond the built-in tools (below), a session's tools come from **MCP
servers** you declare under `mcp:` in `kiri.yaml`. Web search, for example,
via Tavily's remote server:

```yaml
mcp:
  tavily:
    type: http
    url: https://mcp.tavily.com/mcp/
    auth: oauth
```

- A server is either local (`type: stdio` with a `command` — kiri runs it as a
  subprocess) or remote (`type: http`, Streamable HTTP).
- An `http` server authenticates with `auth: oauth` — a browser sign-in kiri
  runs on demand, storing and refreshing tokens in a mode-0600 file under
  `.kiri/`, never in git — or with a static header:
  `headers: { Authorization: { env: <NAME> } }`, always an env reference,
  never a literal.
- Kiri connects on boot and on every `kiri.yaml` edit, discovers each server's
  tools, and namespaces them `<server>__<tool>`. A server that can't connect
  is simply absent, with the reason surfaced in the config-health checks.
- Tool results are untrusted data and capped in size; a call that runs too
  long is reported back to the model as an error. Stopping a turn cancels any
  call in flight.

## Tool permissions

Configuring a server is the standing decision to trust it; each call still
clears you first. Before a tool runs, the session pauses and shows the call
and its input — **Allow** runs it once, **Always allow** never asks again for
that tool, **Deny** skips it and tells the model, which carries on. A pending
approval survives a reload.

Each tool also has a standing permission — **Always allow**, **Ask**
(default), or **Off**, which withholds the tool from the model entirely.
The shell tool alone adds **Auto**, which decides each command as it's
called — see [Running shell commands](#running-shell-commands).
Decisions persist to a gitignored `.kiri/tool-permissions.json` (manage them
in the app, or hand-edit the file) and apply on the next call, no restart.

Kiri's built-in tools carry the same controls, with defaults set by blast
radius: tools that only touch kiri's own data are pre-allowed — asking in
chat is the authorisation — while anything that executes or writes asks
first. Any default can be tightened, or the tool switched off entirely.

| Built-in tool(s) | Default | Why |
| --- | --- | --- |
| Article write / edit / read | Always allow | Only touch kiri's own data. |
| Workflow list / read | Always allow | Read-only, kiri's own data. |
| `use_skill` | Always allow | Read-only, loads instructions you wrote. |
| Filesystem reads | Always allow | Declaring the sandbox is the authorisation. |
| `set_working_directory` | Always allow | Only moves a value confined to the sandbox. |
| `generate_image` | Always allow | Picking an image model is the authorisation. |
| `delegate` | Always allow | Workers only hold tools already always-allowed. |
| `run_workflow`, `rerun_workflow` | Ask | Execute your workflows. |
| Workflow write / edit | Ask | Put runnable YAML in your repo. |
| Filesystem writes / deletes | Ask | Change your files. |
| `run_command` | Ask | Runs shell commands as you. |

## Running workflows

Sessions can run the workflows you've defined. Ask in chat — "run my dev news
round-up" — and the session finds the workflow, fills its declared inputs,
and invokes it. The run is a normal kiri run, with full step output and
traces; the session waits for it to finish and reports the outcome — status,
summary, and any articles produced. A failed run hands the session the
failing step's output, so it can tell you what broke.

Repeat the request and the session reruns the *same* run in place — one feed
entry that updates, not a new one per attempt — executing the workflow as it
is now, so any edits since the last run apply. Stopping the turn cancels the
run too.

## Authoring workflows

Sessions can also write workflows. Work something out in conversation — a
data pull, a report format, a check you'd repeat — then ask the session to
"save that as a workflow" and it authors the YAML into your `workflows/`
directory. It can read your existing workflows to match their style, make
targeted edits to one, or rewrite one wholesale.

- Every write is validated first — YAML, schema, referenced bundles, llm
  providers — so a broken file never lands in your repo; the session is told
  exactly what was wrong and fixes it itself. The saved workflow is a normal
  git change you can review and commit.
- For `llm:` steps the session won't invent a model — it uses what your
  existing workflows use, or asks. Name a preference in `kiri.md` (e.g. "for
  workflow llm steps, prefer `anthropic:claude-haiku-4-5`") if you author
  often.
- Have the session test what it's authoring and it runs the workflow once,
  then reruns that same run after each fix — a single evolving test run
  instead of one per attempt.

## Articles

Ask for a write-up — a report, a digest, a guide — and the session saves it
as an **article** rather than scrolling it into the chat: the same readable
pages workflows produce, charts and diagrams included. The chat reply stays a
short pointer; the piece lives on its own page. Ask for changes and the
session edits the article in place. Articles belong to their session:
deleting the session deletes them.

## Generating images

Pick an **image model** for the session — offered when a provider reports
image-capable models — and it can generate images on request. Selecting the
model is the authorisation, so `generate_image` runs without prompting by
default; each generation is a normal provider-billed call. Generated images
stay in the transcript but are never sent back to the chat model on later
turns, so generating doesn't eat your context window.

## Working with your files

Declare `filesystem:` in `kiri.yaml` and sessions gain file tools over the
directories you list — find files by glob, list a directory, read a file,
search contents by regex, and, with your approval per change, write and edit
files, create directories, and delete files or directories:

```yaml
filesystem:
  allowed_directories:
    - . # the workspace itself
    - ~/projects
  default_working_directory: ~/projects # optional — where sessions start
```

- The list is the entire boundary, and declaring it is what turns the tools
  on — without the section they aren't offered at all. Every path the model
  supplies is checked against it — including through symlinks, and including
  paths it's about to create. Entries resolve relative to the workspace
  root; a leading `~` expands to your home directory (granting the whole
  home directory needs the quoted `"~"` form — a bare `~` is YAML null).
- Hidden (dot-prefixed) files are reachable like any other, with two
  exceptions that are never listed, read, searched, or written: `.git`
  internals, and secret-bearing files — `.env*` and kiri's own credential
  store. Binary files aren't read or written, and oversized results are
  truncated so one big file can't swamp the conversation.
- Reads are pre-allowed — declaring the sandbox is the authorisation. Writes
  and deletes ask, previewing the exact change as a diff. Deleting a
  non-empty directory takes an explicit recursive opt-in, and an allowed
  directory itself can never be deleted.
- Every session has a **working directory** inside the sandbox. It starts at
  `default_working_directory` (the first allowed directory when that's
  unset), relative paths resolve against it, and the assistant moves it —
  within the sandbox — with a `set_working_directory` tool when the work
  settles somewhere else; delegated workers start where their parent is.
  The directory is checked before every turn: if a `kiri.yaml` edit or a
  deletion has invalidated it, the turn refuses to play and says so rather
  than silently working elsewhere — the stale value is cleared as part of
  the announcement, and the next message picks the configured default back
  up on its own.

## Running shell commands

The same `filesystem:` declaration gives sessions a `run_command` tool —
builds, tests, git, your project's own scripts. A command runs in the
session's working directory unless the call names another directory inside
the sandbox.

- Be clear about what the sandbox does here: it confines where a command
  *starts*, not what it can touch — a shell command can reach anything you
  can. That's
  why every call asks by default, showing the exact command verbatim with its
  directory, and why the system prompt holds the model to safe,
  narrowly-scoped commands as a first line of defence in front of your
  approval.
- Commands run non-interactively and are killed at their timeout (120
  seconds unless the call asks for more, capped at ten minutes) — servers
  and watchers aren't supported, and cancelling the turn kills the command
  with it.
- Prefer this for *executing* things; reading and editing files is the
  filesystem tools' job, with its tighter boundary and diff previews.

If asking on every `git status` wears thin, set the tool's permission to
**Auto** and each command is decided as it's called. A deterministic screen
rules first: commands like `sudo`, recursive deletes, force-pushes, or
anything piped into a shell always ask — no model can override that — while
a short list of exactly-matched read-only commands (`git status`, `ls`)
runs straight away. Everything in between is judged by your
[utility model](/docs/llm-providers#utility-model), which sees only the
command and its directory, and asks whenever it errs, times out, or is
unsure — an asked command lands in the normal approval prompt, and every
decision is logged with its reason. Auto needs `models.utility` configured
in `kiri.yaml`; without it, Auto behaves exactly like Ask. Answering
**Always allow** on an approval prompt switches the tool to Always allow —
set it back to Auto afterwards if that's not what you meant.

## Delegating research

For a task that would take a pile of searching and reading — "compare these
three libraries", "what changed in X this year" — the assistant can hand the
legwork to a **delegated worker**: a separate session that runs the task in
its own context and reports back. Only the written report returns to your
conversation, so the transcript holds the findings rather than pages of
intermediate results, and your context window stays lean.

- The worker only holds tools set to **Always allow** — a tool that would ask
  first is simply not offered to it, so delegation never runs anything you
  haven't already allowed to run unprompted. If a research worker comes back
  empty-handed, check that first: your search tool probably needs **Always
  allow**.
- Every delegated task gets a short title from the assistant, naming the work
  wherever it surfaces — so a batch of parallel workers is easy to tell apart.
- Workers don't appear in the activity feed, the session list, or search —
  they belong to the conversation that spawned them — but each is a real
  session you can open, and continue, at its own URL. Cancelling a delegated
  task stops just the worker; the assistant is told and carries on.
- With [delegate models](/docs/llm-providers) configured, the assistant sizes
  each worker it spawns by naming a role — quick for mechanical legwork,
  daily as the default, deep where the result depends on reasoning depth.
  Without them, workers run the same model as the conversation.
- Every delegation also states the worker's own effort level (above) — low
  for cheap parallel legwork, high for deep synthesis — independent of which
  model runs it, and the worker keeps that level for its whole run.

Delegation is on by default; set `delegate` to **Ask** or **Off** like any
other tool.

## Context and cost

Kiri tracks a session's running input/output token spend, and context as
`current / limit` when the provider reports the model's window (Anthropic,
OpenRouter, vLLM, DeepInfra, and LM Studio do; OpenAI doesn't), warning as a
conversation nears the window.

To stretch a session, once context passes halfway kiri trims what it sends
each turn: the three most recent tool results ride in full, older ones are
replaced with a short placeholder. The transcript you see never changes.

## Attachments

Sessions take file attachments and pasted images. Text files (markdown,
source, JSON, CSV) are sent inline so the model reads the whole file; images
ride alongside — worth checking your chosen model accepts image input first.
Attachments are treated as untrusted data and capped to fit the context
window.

## Desktop notifications

Switch **Desktop notifications** on and kiri tells you when work finishes
while you're looking elsewhere: a workflow run landing or a session finishing
a turn pops a system notification that opens the run or session when clicked.
Whatever you're actively watching stays quiet — nothing fires for a run or
session whose page you have focused — and delegated workers never notify;
they report back to their conversation instead.

Notifications come from the browser, so switching them on prompts for browser
permission, and they arrive only while kiri is open in a tab — backgrounded
is fine, closed is not, since kiri never runs in the background. A disabled
switch means the browser has notifications blocked for kiri; re-enable them
in the browser's site settings.
