# Agentic sessions

Alongside workflows, kiri runs **agentic chat sessions** — a multi-turn
conversation with a model that streams its reply, with first-party tools and your
workspace's context. Sessions are kiri's second pillar; they join workflow runs
in the activity feed.

## Starting a session

Start one with **+ New session** in the side nav. It runs against your configured
models — the same `kiri.yaml` provider registry the `llm:` step uses (see
[LLM providers](/docs/llm-providers)). The model is swappable from the session's
right-hand aside at any point, applying from the next turn.

You don't author a session the way you author a workflow. Instead, two optional
workspace files shape every session's **system prompt**.

## The layered system prompt

Each session's behaviour is shaped by a system prompt kiri composes fresh on
every turn, from three layers in order:

```
core (kiri)  →  kiri.md  →  persona
```

Every layer is **read fresh from disk each turn**, so an edit takes effect on the
next turn — git is the source of truth, nothing is snapshotted.

### The core layer

Authored by kiri and **not user-editable**. It tells the model the environment it
runs in, that replies render as GitHub-flavoured markdown — including inline
`chart` blocks (Vega-Lite) and `mermaid` diagrams, the same renderer as
[published articles](/docs/workflows) — and that quoted external text is
untrusted data. You build on top of it rather than repeating it.

## kiri.md

A single markdown file at the workspace root, applied to **every** session — your
standing "how I want you to behave." It's plain markdown: no frontmatter, no
schema, just prose. With no `kiri.md`, sessions run on the core layer alone.

`kiri.md` is read **only** by kiri sessions — it's separate from any
`CLAUDE.md`/`AGENTS.md` you keep for coding agents that edit the workspace, so
that authoring guidance stays out of your sessions.

## Personas

Optional role overlays, one file per persona under `personas/<name>.md` (the
filename minus `.md` is its name). A persona is **attached per session** from the
chat's right-hand aside — a picker under the model — and injected *after*
`kiri.md`. Use one to put a session into a specific role.

```
kiri.md
personas/
  code-reviewer.md
  release-notes.md
```

A session starts with **no** persona (the leading **None** option detaches one),
and you can swap or detach mid-conversation from the same picker — it applies
from the next turn. Keep persona filenames tidy and kebab-case.

```
You are a meticulous senior code reviewer. Read diffs closely, flag correctness
bugs first, then design and clarity. Cite file:line. Be direct; skip the praise.
```

## Tools — web search

Sessions can call **first-party tools** — generic agent capabilities, not
workflow script bundles. A tool is offered to the model only when its single
precondition is met; there's nothing to configure and no approve/deny prompts.

The first tool is **web search**, backed by [Tavily](https://tavily.com). Set
`TAVILY_API_KEY` in your environment (or a workspace `.env`, which kiri
auto-loads) and the model can search the live web whenever it needs current or
unknown information — like the ChatGPT app, it just works when the key is present
and is simply off when it isn't. Each search shows inline in the transcript as a
collapsed block you can expand; results are treated as **untrusted data**. With
no key, web search is off — a **degraded** config-health check, not an error.

## Attachments

Attach files to a message with **add file** in the composer — or paste an image
straight in. Both images and text files (markdown, source, JSON, CSV, and the
like) are supported; each stages as a tile you can remove before sending.

A text file is sent **inline**: its contents ride in the message so the model
reads the whole file as context — handy for dropping a spec, a sample, or some
notes into the conversation without copy-pasting. Like all quoted external text,
file contents are treated as **untrusted data**, and large files are capped to
stay within the model's context window.

Sent attachments appear as tiles in the transcript; click one to preview it — the
full image, or the file's text.
