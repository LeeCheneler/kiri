# Trust & security

Kiri is a tool you run on your own machine against your own repo. Its trust model
follows from that — read this before running workflows you didn't write.

## Kiri runs as you

Bundles (`bundles/<name>/run.sh`) and inline `sh:` steps are shell scripts you
wrote into your own repo, run with **your user's permissions**. Kiri does **not**
sandbox them. Treat them like any shell script you'd run yourself: read it before
you use it, especially when copying a bundle from elsewhere.

This is deliberate — kiri is for personal automation against your real tools, so
a step can use your `gh`, your ssh-agent, your Keychain. `PATH`, `HOME`, `USER`,
and `LOGNAME` are passed through from the kiri process so tools that authenticate
as you keep working.

## What kiri does guard

The defences kiri provides are external, around the orchestrator:

- The HTTP API binds to **`127.0.0.1` only** — not reachable from the LAN.
- State-changing endpoints require a custom **`X-Kiri-Client` header**, so other
  browser tabs and arbitrary local clients can't trigger runs cross-origin.

## Untrusted inputs and AI output

Treat data from outside your repo as **untrusted**:

- **External inputs** — PR titles, issue bodies, fetched items. Don't splice them
  into shell command strings; pass them through env vars or stdin. The
  orchestrator does this for you — preserve it in your bundles.
- **AI output** — a model's stdout flowing into a downstream shell step is just
  another external string. Treat it the same way.
- **Rendered articles and tool results** — markdown renders through a sandboxed
  parser with no raw-HTML pass-through, and quoted external text reaching a
  session is flagged to the model as untrusted data.

## Tool calls in sessions

In sessions, the model can't run an MCP tool behind your back. Unless a tool
is set to **Always allow**, every call pauses for an explicit **Allow / Always
allow / Deny** before it executes — so even a prompt-injected instruction to call
a tool still has to clear you first. Each tool's standing permission (Always
allow, Ask, or **Off** — withheld from the model entirely) is managed on the
Tools & MCP page and persisted by tool name to a gitignored
`.kiri/tool-permissions.json`,
which you can also hand-edit. Kiri's built-in tools follow the same rules with
per-tool defaults: the article tools, workflow listing and reads, and the
authoring guide default to Always allow — they only write articles inside
kiri and read its own data, no shell, no network. The run tools
(`run_workflow`, `rerun_workflow`) run your scripts, and the workflow write
tools put runnable YAML into your repo, so
those default to Ask — and an authored workflow only ever *executes* through
the same gates as any other: a run tool's approval or your click in the
catalog, with the file itself an ordinary git change you can review first.
Every write is validated against the workflow schema before it touches disk.
All of them are listed under **Built-in tools** on the Tools & MCP page, so
any default can be tightened or the tool switched off entirely. See
[Sessions](/docs/sessions).

The file-reading tools have their own boundary: they exist only when you
declare `filesystem: allowed_directories` in `kiri.yaml` — a git-reviewable
decision, like configuring an MCP server. Every path the model supplies must
resolve inside a declared directory (symlinks are followed to their real
target and checked, so a link can't smuggle a path out), hidden dot-files
like `.env` and `.kiri/` are unreachable outright, and the tools are strictly
read-only. They default to Always allow because declaring the sandbox is the
authorisation — narrow the list, or switch them off, and that's the whole
surface gone.

## Secrets

Kiri has no first-class secrets store. Keep secrets **out of YAML and out of
git**:

- **API keys** referenced by `kiri.yaml` are always `{ env: <NAME> }` refs to
  environment variables — a literal key is rejected. Put the value in your
  git-ignored workspace `.env` (kiri auto-loads it) or your environment. See
  [Models & providers](/docs/llm-providers).
- **Other secrets** a step needs (a webhook URL, a token) should come from the
  environment or a mode-600 file you read inside the step — never hard-coded in
  the workflow YAML.
