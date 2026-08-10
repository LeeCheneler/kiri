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

In sessions, the model can't run a tool behind your back. Unless a tool is
set to **Always allow**, every call pauses for an explicit **Allow / Always
allow / Deny** before it executes — so even a prompt-injected instruction to
call a tool still has to clear you first. Standing permissions (Always allow,
Ask, or **Off** — withheld from the model entirely) persist by tool name to a
gitignored `.kiri/tool-permissions.json`.

Built-in tools follow the same rules, with defaults set by blast radius:
tools that only touch kiri's own data are pre-allowed, while anything that
executes or changes your files — running workflows, writing workflow YAML,
filesystem writes, `run_command` — asks first. The full table of defaults is
in [Sessions](/docs/sessions). Three invariants hold throughout:

- **Authored workflows execute only through the same gates.** A workflow a
  session writes is validated against the schema before it touches disk, is
  an ordinary git change you can review, and only ever *runs* via an
  approved run tool or your own invocation.
- **The sandbox is declared in git.** The filesystem and shell tools exist
  only when you declare `filesystem:` in `kiri.yaml` — a reviewable opt-in
  that enables both. Every path must resolve inside the declared
  directories, symlinks included, and secret-bearing files like `.env` and
  `.kiri/` are unreachable outright. The sandbox only anchors where a shell
  command *runs* — a command can touch anything you can — so the approval
  showing the verbatim command is the real boundary. The opt-in **Auto**
  permission moves only the prompting, not the boundary: dangerous command
  shapes always ask — no model can override that — and everything else is
  judged fail-closed, so Auto's worst case is exactly Ask.
- **Delegated workers can't exceed the chat.** A worker session runs
  unattended, so it only holds tools already set to Always allow — one that
  would ask first isn't offered to it at all — and a worker can't spawn
  workers. Delegating can never run anything unprompted that the chat itself
  couldn't.

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
