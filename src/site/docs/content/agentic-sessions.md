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
`kiri.md`. Use one to put a session into a specific role. The picker shows a
**humanised** label derived from the filename — `personas/financial-advisor.md`
lists as *Financial Advisor* — so a tidy kebab-case filename reads cleanly
without any extra config.

```
kiri.md
personas/
  code-reviewer.md
  release-notes.md
```

A session starts with **no** persona (the leading **None** option detaches one),
and you can swap or detach mid-conversation from the same picker — it applies
from the next turn. Keep persona filenames tidy and kebab-case — they drive both
the attach id and the humanised label.

```
You are a meticulous senior code reviewer. Read diffs closely, flag correctness
bugs first, then design and clarity. Cite file:line. Be direct; skip the praise.
```

## Token usage and context

The right-hand aside tracks what a session is spending. **Tokens** shows the
running input, output, and total. **Context** shows how full the model's context
window is — `current / limit` when kiri knows the window, or just the current
figure when it doesn't.

kiri reads the window from the provider's own model listing, so OpenRouter,
Anthropic, vLLM, and LM Studio models show it — including the context length you
set when loading a model in LM Studio. OpenAI's listing doesn't report one, so
those models show the current figure alone. As a conversation nears the window, a
warning appears above the message box: a cue to start a fresh session before a
turn fails.

## Tools — MCP servers

Sessions can call **tools** — capabilities the model invokes mid-turn, not
workflow script bundles. A session's tools come from **MCP servers** you declare
under `mcp:` in `kiri.yaml`, each either a local `stdio` server kiri runs as a
subprocess or a remote `http` (Streamable HTTP) server. Any secret — a server's
API token, say — is an `{ env: <NAME> }` reference, never a literal in the file.

Kiri connects each server when it starts and whenever you edit `kiri.yaml`,
discovers the tools it offers, and namespaces them `<server>__<tool>` so two
servers can't clash. A server's tools appear only when it's configured and
connects; one whose env var is unset or that fails to connect is simply absent,
with the reason shown as a config-health check. There's no approve/deny prompt —
configuring a server is the decision to trust it.

Each tool call shows inline in the transcript as a collapsed block you can
expand; results are treated as **untrusted data**. Kiri ships no built-in tools
of its own — for web search, for example, add an MCP server that provides it.

### Example: web search via the Tavily MCP server

Give sessions web search by adding [Tavily](https://tavily.com)'s remote MCP
server under `mcp:` in your `kiri.yaml`:

```yaml
mcp:
  tavily:
    type: http
    url: https://mcp.tavily.com/mcp/?tavilyApiKey=<api_key>
```

Kiri connects on startup and its tools appear in sessions namespaced
`tavily__<tool>`. Tavily carries the key in the URL itself, so — unlike a
provider `api_key` — it can't be an `{ env: }` reference; keep a `kiri.yaml`
that embeds a literal key out of git. A server that authenticates with a header
instead takes `headers: { Authorization: { env: <NAME> } }`, and a local server
uses `type: stdio` with a `command`. Any MCP server is configured the same way.

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
