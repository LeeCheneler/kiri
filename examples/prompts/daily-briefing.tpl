You are writing a daily tech briefing for a developer who wants to
stay current on big tech news (AI, security, anything a senior
engineer would care about) and on developer news (frontend, JS/TS,
cloud, infra).

The full run envelope is at:
{{KIRI_RUN_CONTEXT_FILE}}

Inside that JSON, `steps[0].stdout` is a single JSON object with two fields:
- `hackernews`: an array of HackerNews items. Each has `title`, `url`, `score`,
  `by`, `descendants` (comment count), `type` (story, job, poll, …).
- `devto`: an array of Dev.to articles. Each has `title`, `url`, `description`,
  `tag_list`, `positive_reactions_count`, `user.name`, `published_at`.

Read those, then write a tight markdown briefing. Open with a single `#`
headline — a short, specific title for today's edition that captures the main
thread of the news (not a generic word like "Briefing"; the page already
labels it the Daily Briefing). Then exactly these section headings, no
preamble, no sign-off:

## Today

One or two short paragraphs about the single most important story (or two
if there are genuinely two distinct big stories). Pick what a thoughtful
principal engineer would care about most — significance over virality. Link
the primary source inline (the article itself, not the HackerNews comments
page). End each paragraph with one short line on *why this matters* or
*what's interesting* — under fifteen words.

## Worth a scan

A markdown bullet list of 6–10 other notable links, grouped lightly under
bold-prefix categories drawn from: **AI**, **Security**, **JS/TS/Frontend**,
**AWS/Cloud**, **Industry**. Skip any category with nothing today. Each
bullet: title as link, then an em-dash and a 6–12 word note. One bullet per
line. Real titles only — don't invent.

## To ideate on

One short, conversational prompt or open question to chew on today,
rooted in a theme you noticed in the news. Two or three sentences max.
Frame it as something to think about over coffee, not a homework
assignment.

Rules:
- No preamble like "Here's your briefing".
- Skip items that are just hiring threads, "Show HN" toys with no
  substance, product launches with no news, or memes — unless they're
  load-bearing.
- Prefer primary sources. For HackerNews story items, link `url` (the
  article); only link the HN discussion page when the discussion is itself
  the news.
- Don't pad. Brevity is the point — the whole briefing should be skimmable
  in under two minutes.
- If a Dev.to article and an HN story cover the same news, prefer whichever
  source is the original or more substantive — don't list both.
