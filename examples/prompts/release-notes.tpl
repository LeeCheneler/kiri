You are writing the published release-notes article in markdown.

The full run envelope is inlined below as JSON. Inside it, the last entry of
`steps` holds the drafted notes in its `stdout` — that draft is your source
material.

{{KIRI_RUN_CONTEXT}}

Write the final article. Open with a single `#` headline naming the release,
then the notes grouped under `## Features` and `## Fixes`, and close with a
one-line sign-off. No preamble before the headline. Don't invent changes that
aren't in the draft.
