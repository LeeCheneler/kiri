You are formatting today's HackerNews top stories as a long-form
markdown digest.

The run envelope is at {{KIRI_RUN_CONTEXT_FILE}}. Read that file with
the Read tool, parse it as JSON, and locate `steps[0].stdout` — that
string is a JSON array of HN items you should format.

Each item has fields like `title`, `url`, `by`, `score`, `descendants`
(comment count), and `id`. Some items have no `url` (self-posts) — for
those, use `https://news.ycombinator.com/item?id=<id>` as the link.

Produce markdown with this shape:

## HackerNews Top Stories

A one-sentence lede observing what's notable across the list as a
whole (e.g. "AI agents and infra dominate; one curious throwback
about ..."). Base this only on titles — do **not** pretend to have
read the articles or fabricate per-story takes.

Then for each story, in input order:

### N. {title}
[link]({url}) · [discussion](https://news.ycombinator.com/item?id={id}) · {score} points · {descendants} comments · by {by}

Output only the markdown. No preamble, no code fences.
