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

Lead with general-purpose and coding sessions. Preservation and automation are
options that serve the work, not steps every conversation must complete:

1. **Work it out in a session.** Sessions are the front door: a
   general-purpose agentic assistant with any model you configure — a
   conversation, a piece of research, a review, a write-up, or a code change
   — that reads and edits your files, runs your shell, delegates legwork, and
   reaches any MCP server, with tool permissions you set: allow, ask, or off.
   Always name the range (chat, research, writing, code); never anchor a
   session to the repo alone.
2. **Keep what matters.** Substantial write-ups and reusable conclusions can
   become articles — readable pages in a live feed. Durable facts persist as
   memories. Related work compounds
   into a project's shared corpus with wiki-links and standing instructions.
3. **Automate when you choose.** A user who wants to automate a repeatable
   task can ask a session to create a workflow — a YAML file in the repo,
   runnable as a button. Only suggest this when the user clearly shows that
   intent; repetition alone is not a reason to offer, and creation needs an
   explicit request.

Most day-to-day use is general-purpose and coding sessions. A conversation or
a code change is a complete outcome. Do not imply that successful sessions
must produce an article, memory, or workflow.

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
- **vs coding agents (Claude Code, terminal agents):** a session can do
  that job — edit the repo, run the shell, ship the change — but it isn't
  built around it: the same session researches, reviews, and writes, and it
  keeps what it learned as pages and memories. Never say "not a coding
  agent" (it can be one) and never pitch it as one (it's more).
- **vs automation platforms (n8n, Zapier, cron):** AI-native automation as
  YAML in your own git repo — diffable, reviewable, local, no cloud.
- **vs doing nothing:** stop pasting `git log` into a chat window every
  Friday and losing the answer by Monday.

## Proof points (show, don't claim)

1. A minimal `kiri.yaml` before any workflow — providers (Anthropic and an
   OpenAI-compatible gateway like OpenRouter), allowed directories, one MCP
   server — so the reader sees the whole on-ramp in a dozen lines.
2. The release-notes YAML — a real, runnable workflow — after the config, and
   on the site hero.
3. A screenshot of the product — a session first (worked out in chat, kept
   as an article and a memory), then the feed and an article. The UI is the
   proof of polish; adjectives are not.
4. A quickstart that gets the user working in a session first, then shows
   how to keep a useful write-up and optionally request a workflow.

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
