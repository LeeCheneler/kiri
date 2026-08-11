# Positioning

The one-page reference for how kiri describes itself. Every outward surface —
README, site hero, docs landing page, empty states, release copy — should say
the same thing; if a piece of copy doesn't fit this document, either the copy
or this document is wrong, and the mismatch is a defect to fix, not ignore.

## One-liner

> Kiri is an AI workspace that runs on your machine and writes things down —
> sessions become readable pages, facts become memories, and repeated chores
> become one-click buttons.

Short form (taglines, descriptions): **A local-first AI workspace where work
compounds — pages instead of scrollback, memories instead of re-explaining,
buttons instead of re-prompting.**

Category noun: **local-first AI workspace**. The category places kiri; the
one-liner sells it. Never lead with the category alone.

## The ladder

Kiri's shape is a progression, and copy should present it in this order:

1. **Work it out in chat.** Sessions are the front door: streaming chat with
   any model you configure, wired into your files, your shell, and any MCP
   server, with tool permissions you set: allow, ask, or off.
2. **Keep what matters.** Output lands as articles — readable pages in a live
   feed — not scrollback. Facts persist as memories. Related work compounds
   into a project's shared corpus with wiki-links and standing instructions.
3. **Automate the repeats.** Anything worth doing twice hardens into a
   workflow — a YAML file in your repo, runnable as a one-click button, and a
   session can author it for you.

Workflows are the top of the ladder, not the front door. They are where
mature work ends up.

## Pain stack (lead with the highest)

1. **AI work evaporates.** Valuable output dies in chat scrollback; every
   session starts from zero. (articles, feed, memories, projects)
2. **Re-prompting the same chore.** The Friday `git log` paste into a chat
   window, again. (workflows, recommendations)
3. **Assistants have amnesia.** Re-explaining context and preferences every
   time. (memories, standing instructions, projects)
4. **Cloud tools can't touch the real repo safely.** Privacy and blast-radius
   worries. (local-first, allowed directories, per-tool permissions, diffs
   before writes)

## Competitive frames

- **vs chat apps (ChatGPT, Claude.ai):** like your chat app, but it lives in
  your repo and writes things down — pages, memories, and buttons instead of
  scrollback.
- **vs coding agents (Claude Code, terminal agents):** not a coding agent — a
  workspace for the knowledge work around your repos: briefings, reviews,
  release notes, research, standing docs.
- **vs automation platforms (n8n, Zapier, cron):** AI-native automation as
  YAML in your own git repo — diffable, reviewable, local, no cloud.
- **vs doing nothing:** stop pasting `git log` into a chat window every
  Friday and losing the answer by Monday.

## Proof points (show, don't claim)

1. The release-notes YAML on the first screen — a real, runnable workflow.
2. A screenshot of the product — the feed, a session, an article. The UI is
   the proof of polish; adjectives are not.
3. The five-minute quickstart whose golden path *is* the ladder: ask a
   session for something → it writes an article → save it as a workflow →
   click the button.

Avoid: "powerful", "seamless", feature soup, unverifiable claims.

## Vocabulary

- "assistant", never "agent", for the actor in user-facing copy. "Agentic"
  as an adjective for the capability (e.g. "agentic sessions") is fine.
- "instructions", never "prompt", for standing instruction layers.
- "article" for the written artifact; "feed" for where it lands.
- "local workflows" when naming the workflow feature — never "one-click
  workflows"; the one-click part describes how a workflow runs ("a button"),
  not what it is.
- Sessions "write things down"; workflows are "buttons"; the workspace
  "compounds" or "accumulates" — ephemerality is the enemy named in copy.
