# Quickstart

Install kiri, run a workflow, and read the article it writes — about five
minutes, and no API key until the last step.

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
kiri init    # scaffold a starter workflow and config
kiri         # serve on :4242
```

Open [local.kiri.build](https://local.kiri.build) — or
`http://localhost:4242` in Safari and Brave, which block HTTPS→localhost —
and click **Run** on the starter workflow to see a run land in the feed.

## Write a report

Now something worth reading. Drop this in `workflows/standup.yaml` — edits are
picked up live, no restart:

```yaml
name: Standup
steps:
  - sh: |
      set -eu
      cd "$KIRI_REPO_ROOT"
      git log --since="7 days ago" --format='- %s (%an)'
    id: commits
    name: Collect the week's commits
articles:
  - slug: standup
    name: Standup Notes
    sh: |
      echo "# This week in $(basename "$KIRI_REPO_ROOT")"
      echo
      printf '%s\n' "$COMMITS"
    env:
      COMMITS: { step: commits }
```

Run it. The run page streams each step, and the article — a rendered markdown
page — lands in your feed. That's the whole loop: **steps produce data,
articles write it up.**

## Add a model

The write-ups get good when a model does the writing. Declare a provider in
`kiri.yaml` (workspace root, kept in git — `kiri init` scaffolds a commented
skeleton):

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

Then let a model write the article instead:

```yaml
articles:
  - slug: standup
    name: Standup Notes
    llm:
      model: anthropic:claude-haiku-4-5
      prompt: |
        Write these commits up as crisp standup notes,
        grouped by theme. Open with a # headline.

        {{COMMITS}}
    env:
      COMMITS: { step: commits }
```

Run it again — same data, but now the article reads like a colleague wrote it.

## Where kiri keeps things

- **`kiri.yaml`** — structured config: model providers, MCP servers, the
  session file sandbox. Committed.
- **`.env`** — secrets, auto-loaded at boot. Git-ignored.
- **`kiri.md`** and **`personas/`** — system-prompt layers for
  [sessions](/docs/sessions).
- **`.kiri/`** — editor schemas and run scratch space. Git-ignored by `kiri init`.

Configuration problems never block boot — kiri prints a health report at
startup and shows the same checks as a banner in the app. To pin a workspace
regardless of where you launch from, set `KIRI_CONFIG_DIR` (a leading `~` is
expanded).

## Next

- [Writing workflows](/docs/workflows) — wire steps together, take inputs,
  recommend follow-ups.
- [Recipes](/docs/recipes) — release notes, one-click PR reviews, a daily
  briefing.
- [Models & providers](/docs/llm-providers) — OpenAI, local models, and the
  provider registry.
