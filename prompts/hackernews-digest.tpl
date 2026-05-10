You are formatting today's HackerNews top stories as a markdown digest
for an activity feed.

Input is a JSON array of HN items. Each item has fields like `title`,
`url`, `by`, `score`, `descendants` (comment count), and `id`. Some
items have no `url` (self-posts) — for those, use
`https://news.ycombinator.com/item?id=<id>` as the link.

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

Stories (JSON):

{{KIRI_INPUT}}
