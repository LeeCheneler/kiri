# Quickstart

Install kiri, work something out in a session, keep the write-up as an
article, then turn it into a one-click workflow — the whole loop in about
five minutes.

## Install

Kiri ships for **macOS on Apple silicon**, via Homebrew:

```sh
brew install LeeCheneler/kiri/kiri
```

Upgrade later with `brew upgrade kiri`. Without Homebrew: download the binary
from the [latest release](https://github.com/LeeCheneler/kiri/releases/latest),
`chmod +x` it, clear quarantine with `xattr -d com.apple.quarantine`, and put
it on your `$PATH`. Want another platform?
[Open an issue](https://github.com/LeeCheneler/kiri/issues).

## Boot a workspace

Kiri runs per directory — each working directory is its own workspace:

```sh
cd ~/projects/some-repo
kiri init    # scaffold config and a starter workflow
kiri         # serve on :4242
```

Open [local.kiri.build](https://local.kiri.build) — or
`http://localhost:4242` in Safari and Brave, which block HTTPS→localhost.

## Connect a model

Kiri brings no model of its own. Declare a provider in `kiri.yaml`
(workspace root, kept in git — `kiri init` scaffolds a commented skeleton):

```yaml
providers:
  anthropic:
    type: anthropic
    api_key:
      env: ANTHROPIC_API_KEY
```

Put the key in a git-ignored `.env` next to it — kiri auto-loads it at boot:

```sh
ANTHROPIC_API_KEY=sk-ant-...
```

No key at all? An OpenAI-compatible local server (LM Studio, Ollama, vLLM)
works too — see [Models & providers](/docs/llm-providers).

## Work it out in chat

Click **+ New session** and ask for something you'd normally lose to a chat
window — say, *"summarise what changed in this repo this week and what's
still open."* Then ask the session to keep it:

> write that up as an article

The write-up lands as an **article**: a readable page in your feed — markdown
with charts and diagrams if the content calls for them — not scrollback. Ask
for changes and the session edits the page in place. Everything a session or
run produces is searchable as you type, ⌘K from anywhere.

## Turn the repeat into a button

That summary is worth having every week — so ask the same session:

> save that as a workflow

The session authors a validated workflow file into `workflows/` (with your
approval — the write shows as a diff first). It's a plain YAML file: shell
steps piped into model steps, diffable and committable like any other code.
From now on it's one click — **Run** on the Workflows page — and each run
writes a fresh article into your feed.

That's the whole ladder: **work it out in chat, keep what matters as
articles, automate the repeats as workflows.**

## Where kiri keeps things

- **`kiri.yaml`** — structured config: model providers, MCP servers, the
  session file sandbox. Committed.
- **`.env`** — secrets, auto-loaded at boot. Git-ignored.
- **`kiri.md`** — standing instructions for [sessions](/docs/sessions).
- **`AGENTS.md`** — per-directory instructions, picked up from the tree a
  session is working in. Not kiri-specific, and can live in any directory kiri
  is allowed to read.
- **`skills/`** — on-demand instruction packs for sessions, one
  `<name>/SKILL.md` per skill. Committed.
- **`workflows/`** — your workflow YAML, hand-written or session-authored.
  Committed.
- **`.kiri/`** — editor schemas and run scratch space. Git-ignored by `kiri init`.

Configuration problems never block boot — kiri prints a health report at
startup and shows the same checks as a banner in the app. To pin a workspace
regardless of where you launch from, set `KIRI_CONFIG_DIR` (a leading `~` is
expanded).

## Next

- [Sessions](/docs/sessions) — instructions, skills, tools, files and shell,
  delegation.
- [Projects & memories](/docs/projects-and-memories) — where work compounds
  across sessions.
- [Writing workflows](/docs/workflows) — wire steps together, take inputs,
  recommend follow-ups.
- [Recipes](/docs/recipes) — release notes, one-click PR reviews, a daily
  briefing.
