# Sessions

A session is an open-ended chat with your configured models, your workspace's
context, and tools from MCP servers you choose. Workflows are for chores
you've scripted; sessions are for the work you haven't. Both land in the same
activity feed.

Start one with **+ New session** in the side nav. Sessions use the same
`kiri.yaml` provider registry as `llm:` steps; swap the model any time from
the right-hand aside — it applies from the next turn. A streaming turn
survives a reload: it keeps running on the server, and reopening the session
rejoins it live.

## Shaping behaviour

Kiri composes each turn's system prompt from three layers, in order:

```
core (kiri)  →  kiri.md  →  persona
```

Every layer is read fresh from disk each turn, so an edit applies on the next
turn — git stays the source of truth.

- **Core** — kiri's baseline, not user-editable: who the assistant is, how to
  respond well, that replies render as markdown (including `chart` and
  `mermaid` blocks), and the trust boundary — your instructions are
  authoritative, quoted external text is untrusted data.
- **`kiri.md`** — a plain markdown file at the workspace root, applied to
  every session: your standing "how I want you to behave." It's read only by
  kiri sessions — separate from any `CLAUDE.md`/`AGENTS.md` you keep for
  coding agents.
- **Personas** — optional role overlays, one file per persona under
  `personas/<name>.md`, attached per session from the aside and injected
  after `kiri.md`. The picker humanises filenames —
  `personas/code-reviewer.md` lists as *Code Reviewer* — and you can swap or
  detach mid-conversation. Add or remove a persona file while kiri is running
  and the picker updates on its own; no reload needed.

```
You are a meticulous senior code reviewer. Read diffs closely, flag
correctness bugs first, then design and clarity. Cite file:line. Be direct.
```

## Tools from MCP servers

Beyond the built-in tools (articles, workflows, and your files, below), a
session's tools come from **MCP servers** you declare under `mcp:` in
`kiri.yaml`. Web search, for example, via Tavily's remote server:

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
  runs on demand (a **Connect** button on the activity page) and whose tokens
  it stores and refreshes in a mode-0600 file under `.kiri/`, never in git —
  or with a static header: `headers: { Authorization: { env: <NAME> } }`,
  always an env reference, never a literal.
- Kiri connects on boot and on every `kiri.yaml` edit, discovers each server's
  tools, and namespaces them `<server>__<tool>`. A server that can't connect
  is simply absent, the reason shown on the activity page.
- Tool calls show inline in the transcript as expandable blocks, and a run of
  back-to-back calls folds into a single expandable panel summarising the
  count, the tools used, and an overall status. Results are untrusted data and
  are capped in size; a call that runs too long is reported back to the model
  as an error. Press **Escape** to stop a running turn.

## Approving tool calls

Configuring a server is the standing decision to trust it; each call still
clears you first. Before a tool runs, the session pauses and shows the call
and its input:

- **Allow** — run it once; ask again next time.
- **Always allow** — run it and never ask again for this tool.
- **Deny** — don't run it; the model is told and carries on.

Each tool also has a standing permission — **Always allow**, **Ask** (default),
or **Off**, which withholds the tool from the model entirely. Manage them on
the **Tools & MCP page** in the left nav; decisions persist to a gitignored
`.kiri/tool-permissions.json` and apply on the next call, no restart. A pending
approval survives a reload — the session picks up where it paused.

Kiri's built-in tools carry the same controls, each with its own default:
the article tools, workflow listing and reads, and the authoring guide
default to **Always allow** — they only touch kiri's own data, and asking in
chat is the authorisation — as do the file-reading tools, whose reach is the
`filesystem:` sandbox you declared (see *Working with your files* below). The
run tools (`run_workflow`, `rerun_workflow`) execute your workflows, the
workflow write tools put files in your repo, and the filesystem write tools
change your own files, so those default to **Ask**. All of them are listed
under **Built-in tools** on the same Tools & MCP page, so any default can be
reviewed and changed, including switching a tool off entirely.

## Running workflows

Sessions can run the workflows you've defined. Ask in chat — "run my dev news
round-up" — and the session finds the workflow, fills its declared inputs, and
invokes it for you:

- The run is a normal kiri run: it appears in the activity feed as it
  executes, with full step output and traces on its run page.
- The session waits for the run to finish and reports the outcome — status,
  summary, and any articles it produced. A failed run hands the session the
  failing step's output, so it can tell you what broke. Ask and it reads a
  produced article back to you. Stopping the turn (**Escape**) cancels the
  run too.
- Repeat the request and the session reruns the *same* run in place — one
  feed entry that updates, not a new one per attempt. The rerun executes
  the workflow as it is now, so any edits since the last run apply.
- Running or rerunning a workflow asks for approval by default; listing
  your workflows never prompts. All are permissions you can change under
  **Built-in tools** on the Tools & MCP page.

## Authoring workflows

Sessions can also write workflows. Work something out in conversation —
a data pull, a report format, a check you'd repeat — then ask the session
to "save that as a workflow", and it authors the YAML file into your
`workflows/` directory. It can read your existing workflows to match their
style, make targeted edits to one, or rewrite one wholesale:

- Every write is validated first — YAML, schema, referenced bundles, llm
  providers — so a broken file never lands in your repo; the session is
  told exactly what was wrong and fixes it itself.
- Creating or editing a workflow asks for approval by default (it's a file
  in your repo); reading one never prompts. The saved workflow appears in
  your catalog immediately and is a normal git change you can review and
  commit.
- For workflows with `llm:` steps the session won't invent a model — it
  uses what your existing workflows use, or asks. Name a preference in
  `kiri.md` (e.g. "for workflow llm steps, prefer
  `anthropic:claude-haiku-4-5`") and sessions will pick it automatically —
  recommended if you author often.
- Have the session test what it's authoring and it runs the workflow once,
  then reruns that same run after each fix — your feed keeps a single
  evolving test run instead of collecting one per attempt.

## Articles

Ask for a write-up — a report, a digest, a guide — and the session saves it as
an **article** rather than scrolling it into the chat: the same readable pages
workflows produce, charts and diagrams included. The chat reply stays a short
pointer; the piece itself lives on its own page.

- Articles the session has written are listed in the right-hand aside and on
  the session's feed row; click through to the full reading view.
- Ask for changes and the session edits the article in place — an open article
  page updates live as the edit lands.
- Articles belong to their session: deleting the session deletes them.

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
```

- The list is the entire boundary, and declaring it is what turns the tools
  on — without the section they aren't offered at all. Every path the model
  supplies is checked against it — including through symlinks, and including
  paths it's about to create. Entries resolve relative to the workspace
  root; a leading `~` expands to your home directory (granting the whole
  home directory needs the quoted `"~"` form — a bare `~` is YAML null).
- Hidden (dot-prefixed) files are never listed, read, searched, or written —
  `.env` and `.kiri/` stay out of reach. Binary files aren't read or
  written, and oversized results are truncated with a note so one big file
  can't swamp the conversation.
- The read tools default to **Always allow** — declaring the sandbox is the
  authorisation. The write tools — write file, edit file, create directory,
  delete file, delete directory — default to **Ask**: each change pauses for
  your decision with the exact edit previewed as a diff, and the transcript
  shows every change it made the same way. Deleting a non-empty directory
  takes an explicit recursive opt-in, and an allowed directory itself can
  never be deleted. Tighten or switch any of them off under **Built-in
  tools** on the Tools & MCP page.

## Pinning

Pin a session to keep it to hand. **pin session** in the right-hand aside
puts it on the **Pinned** tab of the activity feed; **unpin session** takes
it off. A pin is just a bookmark — it doesn't change how the session runs,
and the session still appears in the other feed views as usual.

## Context and cost

The right-hand aside tracks spend as you go: running input/output **tokens**,
and **context** as `current / limit` when the provider reports the model's
window (Anthropic, OpenRouter, vLLM, DeepInfra, and LM Studio do; OpenAI
doesn't). As a conversation nears the window a warning appears above the
composer.

To stretch a session, once context passes halfway kiri trims what it sends
each turn: the three most recent tool results ride in full, older ones are
replaced with a short placeholder. The transcript you see never changes.

## Attachments

Attach files with **add file** in the composer, or paste an image straight in.
Text files (markdown, source, JSON, CSV) are sent inline so the model reads
the whole file; images ride alongside. Attachments are treated as untrusted
data and capped to fit the context window. Click a sent tile to preview it.
