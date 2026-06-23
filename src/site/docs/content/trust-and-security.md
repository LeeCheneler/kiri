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
  session is flagged to the model as untrusted data. Don't reintroduce
  `dangerouslySetInnerHTML` in any custom UI that renders article content.

## Tool calls in sessions

In agentic sessions, the model can't run a tool behind your back. Every tool call
pauses for an explicit **Allow / Always allow / Deny** before it executes — so
even a prompt-injected instruction to call a tool still has to clear you first.
**Always allow** persists a grant (by tool name) to a gitignored
`.kiri/tool-grants.json` so that tool stops prompting; delete its entry from that
file to revoke. See [Agentic sessions](/docs/agentic-sessions).

## Secrets

Kiri has no first-class secrets store. Keep secrets **out of YAML and out of
git**:

- **API keys** referenced by `kiri.yaml` are always `{ env: <NAME> }` refs to
  environment variables — a literal key is rejected. Put the value in your
  git-ignored workspace `.env` (kiri auto-loads it) or your environment. See
  [LLM providers](/docs/llm-providers).
- **Other secrets** a step needs (a webhook URL, a token) should come from the
  environment or a mode-600 file you read inside the step — never hard-coded in
  the workflow YAML.
