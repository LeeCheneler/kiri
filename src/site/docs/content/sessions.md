# Sessions

A session is streaming chat with any model you configure, carrying your
workspace's standing instructions, wired into your files and shell, and
extended by any MCP server you add. When something you worked out is worth
repeating, the session can
[author it into a workflow](#authoring-workflows) so the next time is one
click.

You can swap a session's model mid-conversation — it applies from the next
turn — and a streaming turn survives a page reload: reopening the session
rejoins it live.

## Articles

Ask for a write-up — a report, a digest, a guide — and the session saves it
as an **article**: a readable page in your feed, charts and diagrams
included, rather than scrollback. Ask for changes and it edits the page in
place; ask for it to go and it deletes it.

Articles belong to their session — unless the session lives in a project,
where they land in the project's shared corpus instead: see
[Projects & memories](/docs/projects-and-memories).

## Shaping behaviour

Each turn's system prompt layers your standing instructions, broadest
first — and where two conflict, the narrower wins:

```
core (kiri)  →  kiri.md  →  project instructions  →  AGENTS.md chain
```

- **`kiri.md`** — markdown at the workspace root, applied to every session:
  your standing "how I want you to behave."
- **[Project instructions](/docs/projects-and-memories#project-instructions)**
  — carried by every session in a project.
- **`AGENTS.md` chain** — per-directory instructions collected from the
  session's [working directory](#working-with-your-files) up the tree,
  nearer files winning. It's the same `AGENTS.md` convention other coding
  assistants follow, so an existing repo needs no kiri-specific setup. Only
  files inside your allowed directories are read, and kiri never writes one.

```
Answer in British English. Be direct, lead with the answer, and cite
file:line when you reference code.
```

Every layer is read fresh each turn, so an edit applies on the next turn.

## Skills

A **skill** is a named pack of instructions loaded only when its task comes
up — standing instructions are always-on, skills are on-demand. Your
release-notes format or code-review checklist belongs in a skill, not padded
into every conversation via `kiri.md`.

Keep each one at `skills/<name>/SKILL.md`, committed like the rest of your
config:

```markdown
---
name: release-notes # optional — defaults to the directory name
description: Draft release notes in this project's format.
---

The instructions the assistant follows once the skill is loaded…
```

Unknown frontmatter fields are ignored, so skills written for other tools
drop in unmodified. Edits apply from the next turn. Kiri ships a few
first-party skills alongside yours — name a skill the same as one and yours
wins.

## Memories and projects

Sessions save durable facts as **memories** every future session recalls,
and group related work into **projects**:
[Projects & memories](/docs/projects-and-memories).

## Effort

Every session has an **effort level** — `low`, `medium` (the default),
`high`, `xhigh`, or `max` — setting how hard the assistant works, using the
provider's native reasoning controls where the model has them. Model and
effort are independent levers: a large model can answer briskly at `low`, a
small one can take its time at `high`.

## Tools from MCP servers

Beyond the built-in tools, a session's tools come from **MCP servers**
declared under `mcp:` in `kiri.yaml`. Web search, for example, via Tavily:

```yaml
mcp:
  tavily:
    type: http
    url: https://mcp.tavily.com/mcp/
    auth: oauth
```

- A server is local (`type: stdio` with a `command`) or remote
  (`type: http`).
- Remote auth is `auth: oauth` — a browser sign-in kiri runs on demand,
  tokens stored outside git — or a static header:
  `headers: { Authorization: { env: <NAME> } }`, always an env reference.
- Servers connect on boot and on every `kiri.yaml` edit; tools are named
  `<server>__<tool>`. One that can't connect shows up in the config-health
  checks with the reason.

Every field is listed in the [kiri.yaml reference](/docs/kiri-yaml).

## Tool permissions

Every tool has a standing permission — **Always allow**, **Ask** (default),
or **Off**, which withholds it from the model entirely. A tool on Ask pauses
before running and shows the call: **Allow** runs it once, **Always allow**
stops asking, **Deny** skips it and the model carries on. Decisions persist
to a gitignored `.kiri/tool-permissions.json` and apply immediately.

Built-in defaults follow blast radius — touching kiri's own data is
pre-allowed, executing or writing asks first — and any default can be
tightened or switched off:

| Built-in tool(s) | Default | Why |
| --- | --- | --- |
| Article write / edit / delete / read | Always allow | Only touch kiri's own data. |
| Workflow list / read | Always allow | Read-only, kiri's own data. |
| `use_skill` | Always allow | Read-only, loads instructions you wrote. |
| Memory save / read / delete | Always allow | Only touch kiri's own data; the Memories page is the curation surface. |
| `update_project_instructions` | Always allow | Only runs when you ask, and shows the change as a diff. |
| Filesystem reads | Always allow | Declaring the sandbox is the authorisation. |
| `set_working_directory` | Always allow | Only moves a value confined to the sandbox. |
| `generate_image` | Always allow | Picking an image model is the authorisation. |
| `delegate` | Always allow | Workers only hold tools already always-allowed. |
| `run_workflow`, `rerun_workflow` | Ask | Execute your workflows. |
| Workflow write / edit | Ask | Put runnable YAML in your repo. |
| Filesystem writes / deletes | Ask | Change your files. |
| `run_command` | Ask | Runs shell commands as you. |

The shell tool alone adds **Auto** — see
[Running shell commands](#running-shell-commands).

## Running workflows

Ask in chat — "run my dev news round-up" — and the session finds the
workflow, fills its inputs, and runs it, reporting status, summary, and any
articles produced. A failed run hands the session the failing step's output
so it can tell you what broke. Repeat the request and it reruns the same run
in place — one feed entry that updates, not a new one per attempt.

## Authoring workflows

Work something out in conversation, then ask the session to "save that as a
workflow" and it authors the YAML into `workflows/` — validated before it
lands, so a broken file never reaches your repo, and a normal git change you
review like any other. It can also edit existing workflows, match their
style, and — asked to test — run one and iterate on the same run after each
fix.

For `llm:` steps the session won't invent a model: it follows your existing
workflows, or asks. Name a preference in `kiri.md` if you author often.

## Generating images

Pick an **image model** for the session — offered when a provider reports
image-capable models — and it generates images on request. Generated images
stay in the transcript without being resent to the chat model later, so they
don't eat your context window.

## Working with your files

Declare `filesystem:` in `kiri.yaml` and sessions gain file tools over the
directories you list — find, list, read, and search pre-allowed; writes,
edits, and deletes asking first with the exact change previewed as a diff:

```yaml
filesystem:
  allowed_directories:
    - . # the workspace itself
    - ~/projects
  default_working_directory: ~/projects # optional — where sessions start
```

- The list is the entire boundary — without the section the tools aren't
  offered at all, and every path is checked against it, symlinks included.
  A leading `~` expands to your home (the whole home directory needs the
  quoted `"~"` form).
- `.git` internals and secret-bearing files — `.env*`, kiri's credential
  store — are never listed, read, or written.
- Every session has a **working directory** inside the sandbox — where
  relative paths resolve and commands run. It starts at
  `default_working_directory` (or the first allowed directory) and the
  assistant can move it within the sandbox as the work settles somewhere
  else.

## Running shell commands

The same `filesystem:` declaration gives sessions a `run_command` tool —
builds, tests, git, your own scripts — run in the session's working
directory. The sandbox confines where a command *starts*, not what it can
touch, so every call asks by default, showing the exact command verbatim.
Commands run non-interactively with a timeout; servers and watchers aren't
supported.

If asking on every `git status` wears thin, set the tool to **Auto**:
obviously safe read-only commands run straight away, dangerous shapes
(`sudo`, recursive deletes, force-pushes, anything piped into a shell)
always ask — no model can override that — and everything in between is
judged by your [utility model](/docs/llm-providers#utility-model), asking
whenever it's unsure. Auto needs `models.utility` configured; without it,
Auto behaves exactly like Ask.

## Delegating research

For a task that would take a pile of searching and reading — "compare these
three libraries" — the assistant can hand the legwork to a **delegated
worker**: a separate session that runs the task in its own context and
reports back. Only the written report returns to your conversation, so your
context window stays lean.

- A worker only holds tools set to **Always allow** — anything that would
  ask isn't offered to it, so delegation never runs what you haven't already
  allowed. A research worker coming back empty-handed usually means your
  search tool needs **Always allow**.
- Workers don't appear in the feed, session list, or search — but each is a
  real session you can open at its own URL. Cancelling one stops just that
  worker.
- With [delegate models](/docs/llm-providers) configured, the assistant
  sizes each worker's model per task; each delegation also sets the worker's
  own effort level.

Delegation is on by default; set `delegate` to **Ask** or **Off** like any
other tool.

## Context and cost

Kiri tracks a session's token spend, and context as `current / limit` when
the provider reports the model's window, warning as a conversation nears it.
Long sessions are stretched automatically — older tool results are trimmed
from what's sent each turn; the transcript you see never changes.

## Attachments

Sessions take file attachments and pasted images. Text files are sent inline
so the model reads the whole file; images ride alongside — check your model
accepts image input. Attachments are capped to fit the context window.

## Titles

Kiri names a new session automatically off your first message. Rename or
clear it from the session page any time; titles are searchable alongside
message text.

## Desktop notifications

Switch **Desktop notifications** on and kiri notifies you when a run lands
or a session finishes a turn while you're looking elsewhere — clicking opens
the work. The page you're actively watching stays quiet. Notifications come
from the browser (so switching them on prompts for permission) and arrive
only while kiri is open in a tab — kiri never runs in the background.
