# Sessions

A session is a general-purpose agentic assistant with any model you
configure — a conversation, a piece of research, a review, a write-up, or a
code change. It carries your workspace's standing instructions, reads and
edits your files, runs your shell, delegates legwork, and is extended by any
MCP server you add. When something you worked out is worth
repeating, the session can
[author it into a workflow](#authoring-workflows) so the next time is one
click.

You can swap a session's model mid-conversation — it applies from the next
turn — and a streaming turn survives a page reload: reopening the session
rejoins it live.

Kiri saves progress after each completed model/tool step. If a later provider
request fails, completed actions and useful partial replies remain in the
conversation after reload, ready for your next message. A failed turn does
not automatically repeat completed actions. If an action's result never
arrived, its outcome may be unknown; check its effect before retrying.

A turn can take up to **64 work steps**, each a model response that may
call tools. If it still needs to continue, Kiri saves a stopping notice and
allows one final response, when it fits the context budget, with tools disabled to summarise completed work,
what remains, and why it stopped. The turn is marked failed with the step
limit as its reason. The notice and saved work remain available if that
summary fails or is empty; send another message to continue. A normal final
answer on step 64 completes normally. Tool approvals still pause for your
decision, and you can cancel during either the work or the final summary.

## Articles

Ask for a write-up — a report, a digest, a guide — and the session saves it
as an **article**: a readable page in your feed, charts and diagrams
included, rather than scrollback. Ask for changes and it edits the page in
place; ask for it to go and it deletes it.

Articles belong to their session — unless the session lives in a project,
where they land in the project's shared corpus instead: see
[Projects & memories](/docs/projects-and-memories).

## Shaping behaviour

Every session, including a delegated worker, receives your standing
instructions. Where applicable instructions conflict, precedence is highest
first:

```
Enforced Kiri constraints → explicit user requests → nearest AGENTS.md
  → project instructions → kiri.md → loaded skills → general defaults
```

- **`kiri.md`** — markdown at the workspace root, applied to every session:
  your standing "how I want you to behave."
- **[Project instructions](/docs/projects-and-memories#project-instructions)**
  — carried by every session in a project.
- **`AGENTS.md` chain** — per-directory instructions collected from the
  session's [working directory](#working-with-your-files) and the paths its
  file tools change, nearer files winning. It's the same `AGENTS.md` convention
  other coding assistants follow, so an existing repo needs no kiri-specific setup. Only
  files inside your allowed directories are read. Secret-bearing paths and
  internal `.git`/`.kiri` files are excluded, including symlink targets.

Tool permissions, filesystem boundaries, and the requirement that Kiri runs
while the app is active cannot be overridden by instructions. A worker's
brief cannot waive inherited rules or approve a tool call. Skill instructions
loaded through `use_skill` guide their specific task; ordinary file contents,
web pages, and other tool results remain data, even if they claim authority.

```
Answer in British English. Be direct, lead with the answer, and cite
file:line when you reference code.
```

Standing instructions are read fresh before each model step. Edits take
effect as the assistant continues within the same turn. Moving to another
directory replaces the directory rules before the assistant continues there;
the previous directory's rules are no longer applied outside their scope.

Before changing files, Kiri also checks nested `AGENTS.md` files that govern
the target. You do not need to move the session's working directory into
each subdirectory. If the assistant has not received the current rules,
the tool leaves the files untouched and supplies those rules for the
assistant to consider before retrying. Recursive directory deletion checks
the descendants too. Retries follow the usual approval policy, including
when instructions changed while a call was waiting for your approval.

Workflow authoring checks the workspace's instruction chain for the YAML
file, even without filesystem access enabled. Shell commands check the
chain for their execution directory; Kiri does not infer every path touched
by a shell command or an external tool.

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
wins. Loaded skill instructions are retained when evidence is compacted.
The assistant can reload a skill if its instructions are missing or have
changed; it should reuse instructions already available.

## Memories and projects

Sessions save durable facts as **memories** every future session recalls,
and group related work into **projects**:
[Projects & memories](/docs/projects-and-memories).

## Finding prior work

Ask "What did we conclude about the database last month?" and the assistant
can use **`search_knowledge`** to find saved articles, session text, memories,
run summaries, and workflow names and descriptions. It can then use
**`open_knowledge`** to read a source and link it in its answer. Workflow
articles are discoverable without knowing the original run ID.

| Search scope | Included records |
| --- | --- |
| Default in a project session | That project's articles, sessions, and memories. |
| Default outside a project, or explicit workspace scope | All projects and standalone work, including global memories, workflow runs, and workflow definitions. |
| Explicit project | That project's articles, sessions, and memories. |

A project search never silently broadens when empty. Ask to look across the
workspace when relevant work belongs elsewhere. Runs and workflow definitions
have no project ownership, so they appear only in workspace searches. Existing
memory tools can still read global memories from a project session.

Search returns up to 20 hits per call (10 by default), with snippets,
ownership, available dates, stable references, and links. The assistant can
page through results or refine the query within one session. Results reflect
live saved data, so edits and deletions can change later pages.

Opening a session reads an excerpt near the matching message, with nearby
messages for context. Without a message reference it starts at the beginning.
Each read includes at most five messages and **12,000 UTF-8 bytes of text**
across all excerpts, plus metadata; this is a byte limit, not a token count.
Even a single oversized message is pageable, with references to earlier and
later text. Tool outputs, reasoning, images, and hidden workers' transcripts
are excluded. Opening a run returns its saved summary and status; opening a
workflow returns its current parsed definition.

Saved conclusions may be stale or superseded. The assistant is guided to read
the source, check for corrections, and distinguish a recorded conclusion from
a fresh verification. Retrieved text is evidence, not standing instructions
or permission to repeat an action.

Both tools default to **Always allow** and can be set to **Ask** or **Off**
on the Tools & MCP page. Delegated sessions use the same permissions and
project defaults.

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
| `read_tool_result` | Always allow | Reads saved results from this session without repeating actions. |
| `search_knowledge`, `open_knowledge` | Always allow | Read saved knowledge within an explicit scope, defaulting to the current project when present. |
| Memory save / read / delete | Always allow | Only touch kiri's own data; the Memories page is the curation surface. |
| `update_project_instructions` | Always allow | Only runs when you ask, and shows the change as a diff. |
| Task list / add / update, group create / update | Always allow | Only touch kiri's own data; the project page is the curation surface. |
| Task delete, group delete | Ask | Remove tracked work. |
| Filesystem reads | Always allow | Declaring the sandbox is the authorisation. |
| `set_working_directory` | Always allow | Only moves a value confined to the sandbox. |
| `generate_image` | Always allow | Picking an image model is the authorisation. |
| `delegate` | Always allow | Workers' own calls stay gated by these same permissions. |
| `message_worker`, `message_parent` | Always allow | Only move text between the conversation's own sessions. |
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
workflow" and it authors the YAML into `workflows/` through tools that validate
the definition and referenced dependencies before saving. It becomes a normal
git change you review like any other. It can also edit existing workflows, match their
style, and — asked to test — run one and iterate on the same run after each
fix.

With suitable file or command tools enabled and the workspace paths allowed,
a session can also create bundle scripts and prompt templates. Those files
have their own approval gates and must exist before the workflow references
them. A new bundle script needs executable permissions, which text-file writes
alone cannot set. Without the necessary access, the assistant uses existing
bundles and inline prompts, or explains what you need to provide. Direct file
writes do not receive the workflow tools' validation.

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
  else. The new directory's instructions apply within the same turn. If it
  disappears — a deleted checkout, a narrowed sandbox — the
  session falls back to the default and the assistant lets you know.

File searches start in the working directory. The assistant can target another
allowed directory or explicitly search all allowed roots. Search and directory
results come in pages; reaching a scan limit is flagged separately so an
unfinished search is not mistaken for an empty one.

The assistant can read specific line ranges, including portions beyond a large
file's initial excerpt, and request surrounding context with search matches.
Long results include continuation information; shortened search lines and
partial read lines are marked. File text keeps its whitespace and line endings
for precise edits. Pages read current files, so edits between calls can move
results.

## Running shell commands

The same `filesystem:` declaration gives sessions a `run_command` tool —
builds, tests, git, your own scripts — run in the session's working
directory. The sandbox confines where a command *starts*, not what it can
touch, so every call asks by default, showing the exact command verbatim.
Commands support foreground-only work: use non-interactive, one-shot modes
that finish within the timeout (120 seconds by default, at most 600). Servers,
watchers, daemons, detached/background jobs, and leaving processes running
after the call are unsupported. Approval does not add background process
management. Timeout or cancellation kills the command process; cleanup of
its child processes is not guaranteed. While a command runs, expanding its block in the chat shows the
output streaming live — stdout and stderr merged, as a terminal would show
it — so a long build or test run shows progress instead of an opaque
"Running…" until it exits.

If asking on every `git status` wears thin, set the tool to **Auto**:
obviously safe read-only commands run straight away, dangerous shapes
(`sudo`, recursive deletes, force-pushes, anything piped into a shell)
always ask — no model can override that — and everything in between is
judged by your [utility model](/docs/llm-providers#utility-model), asking
whenever it's unsure. Auto needs `models.utility` configured; without it,
Auto behaves exactly like Ask. The judge is instructed to ask for commands
that start unsupported background or long-running processes, even if
precedent records earlier approvals. This guidance does not enforce a
runtime ban on those commands.

Auto also learns from your decisions. Approvals and denials are distilled
into precedent the judge reads on later commands, so a script you've
approved a few times stops asking — and a command shape you've denied keeps
asking.

## Delegating research

Small investigations, including searching and reading a result, can stay in
your conversation. For substantial independent work — investigating each of
three libraries before comparing them, for example — the assistant can use
**delegated workers** when parallel work, focused investigation, or separate
context justifies the handoff. Closely connected reasoning stays together.

A worker runs in the background in its own context and sends labelled notes
you can expand. Its reports retain supporting sources, distinguish findings
from inference, and identify uncertainty and unfinished work. The assistant
can ask for missing evidence or verify a consequential claim before using it
in your answer, without routinely repeating the worker's investigation.

- The assistant and its workers talk both ways: it can steer a worker
  mid-task, nudge a quiet one, or answer a question a worker sends back. A
  worker's result arriving after the assistant has finished its reply starts
  a new one, so fanned-out research assembles itself as the reports land.
- Kiri sends a notice whenever a worker's turn ends, including failure,
  cancellation, or a work/context limit. If the worker omitted its report,
  the notice includes a bounded excerpt of its saved final reply or a link
  to its transcript. A report already sent is not repeated. A progress note
  or a stopped turn does not mean the task is complete: the assistant checks
  what remains before answering. Notices queue while your conversation is
  paused for approval or cancelled; they do not restart it.
- A worker holds the same tools as the chat, under the same permissions — a
  call on **Ask** pauses that worker until you allow or deny it, exactly as
  it would in the chat, so delegation never runs anything unprompted that
  the chat itself couldn't. Only you can answer a pause: the assistant
  can't approve its workers' calls, and messages sent to a paused worker
  queue until it resumes.
- Workers inherit workspace and project instructions, and load the
  `AGENTS.md` chain for their working directory. They start in the parent's
  directory and project. Their brief supplies task-specific details; the
  parent conversation itself is not copied.
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
Before every model request, Kiri estimates the space needed for the current
conversation, refreshed instructions, incoming messages, and tool definitions.
It reserves space for output, reasoning, and new tool results. If the provider
reports higher input usage than estimated, subsequent checks in that turn
use the higher ratio. Estimates are approximate, not exact provider token
counts.

Under context pressure, large saved results from built-in evidence reads
become partial excerpts with references to the original results. Small
results, loaded skills, conversation text, task lists, action outcomes,
errors, and worker messages stay available. Results from unknown tools also
remain intact. New results must be saved before they can be shortened.
Compaction requires `read_tool_result` to be enabled; with that tool off,
full results remain in context. The stored transcript is never shortened.

When a model's context window is unknown, Kiri uses a conservative **32,768-token
working window** for these checks; this is not a claim about the provider's
actual limit. Switching models recalculates the budget on the next turn.

A large tool catalogue and lengthy standing instructions can consume most
of that fallback budget before much work has happened. A fresh session may
therefore still reach it quickly. Use a model with a larger known window or
turn off tools you do not need; bounded knowledge reads limit retrieved text,
not the size of the tool catalogue or standing instructions.

If the remaining context still exceeds the working budget, Kiri stops with
an explicit incomplete-work notice and attempts one tool-free handoff if it
fits. If even the handoff cannot fit, the notice and saved progress remain
without another model request. Use a model with a larger known context window,
or start a fresh session carrying over the saved progress. Completed actions
should not be repeated just to recover their output.

The assistant can reopen a saved tool result with `read_tool_result`, given
its message ID and tool-call ID. Results arrive in bounded pages with a
continuation offset. This reads the recorded output, including recorded
errors, without running the original action again. It only accesses the
current session's transcript; a worker cannot use it to read its parent's
conversation. Saved output is historical evidence, not a fresh check of
the world or permission to repeat an action.

## Attachments

Sessions take file attachments and pasted images. Text files are sent inline
so the model reads the whole file; images ride alongside — check your model
accepts image input. Attachments are capped to fit the context window.

## Titles

Kiri names a new session automatically off your first message. Rename or
clear it from the session page any time; titles are searchable alongside
message text.

## Suggested replies

When a turn ends with something a short answer settles — "shall I go
ahead?", an either-or choice — kiri offers those answers as tap-to-send
replies. Tapping one sends it as an ordinary message. Most replies are
open-ended and get no suggestions; that's by design. Suggestions come from
your [utility model](/docs/llm-providers#utility-model), so without one
configured they're off.

## Push to talk

Hold **hold to talk**, wait for it to read **listening…**, say your message,
and let go. The recording is transcribed by your
[transcription model](/docs/llm-providers#transcription-model), with only outer
whitespace trimmed; kiri does not rewrite the result through the utility model.
The words returned by speech-to-text land in the draft after whatever you'd
typed, and go out only when you send them. Without a transcription model
configured the button isn't offered.

The microphone it listens to is the browser's default unless you pick one
under **settings**; the choice is remembered, and the microphone in use is
named at the foot of the composer beside the model and effort.

## Desktop notifications

Switch **Desktop notifications** on and kiri notifies you when a run lands,
a session finishes a turn, or a session pauses for a tool approval — a
delegated worker's pause included, since the delegation sits stalled until
you answer. Clicking opens the work. The page you're actively watching
stays quiet, and a worker counts as watched from its parent's page too,
where its approval prompt shows inline. A worker's other comings and
goings — reporting back, being messaged — never notify; the conversation
holding the delegation is where those land. Notifications come from the
browser (so switching them on prompts for permission) and arrive only
while kiri is open in a tab — kiri never runs in the background.
