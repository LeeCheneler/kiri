# Projects & memories

Sessions end; what they learned shouldn't. Kiri keeps two kinds of durable
record across conversations: **memories** — small facts the assistant recalls
everywhere — and **projects** — named containers where a body of work builds
a shared corpus of articles. Both live in kiri's own database, not your repo.

## Memories

A **memory** is a small durable fact the assistant carries across sessions —
a preference, standing context, or a correction you've given. Tell kiri to
remember something (or correct it in a way worth keeping) and it saves the
fact; every later session sees an index of memory names and one-line
summaries in its instructions and loads a full body only when it looks
relevant, so recall costs almost nothing until it's used. Saving an existing
memory's name rewrites it in place — a misunderstood memory is corrected in
one step, just explain what it got wrong.

The **Memories page** is where you curate the record: read any memory, edit
its summary or body, and delete what's wrong or stale. The memory tools run
without prompting by default — that page is your standing oversight — and can
be set to Ask or Off like any [other tool](/docs/sessions#tool-permissions).

## Projects

A **project** is a named container for a body of work: a shared corpus of
articles and the sessions that build it. Create one from the Projects page
and start sessions inside it — a session belongs to a project from creation
or not at all, and its feed rows name the project.

### The shared corpus

Every article a project session writes lands in the project rather than in
any one conversation. Each session sees the whole corpus, reads any article
on demand, and keeps existing ones current, whoever wrote them:

- A project session's instructions carry the **corpus index** — slugs and
  titles only. An article's body enters the conversation only when the
  assistant reads it, so a growing corpus costs nothing until it's used.
- Articles cross-reference each other with `[[slug]]`: in the project's
  reading view and in a project session's chat, the reference renders as a
  link to that article, so the corpus browses like a small wiki. The
  assistant knows the syntax and cross-links as it writes.
- Corpus articles outlive the sessions that wrote them — deleting a session
  never touches the corpus.

### Project instructions

A project carries its own **standing instructions**: markdown written on the
project page and layered into every session in the project, between your
workspace's `kiri.md` and any `AGENTS.md` chain (see
[Shaping behaviour](/docs/sessions#shaping-behaviour)). Edit them at any
time; sessions pick the new text up on their next turn.

You can also ask a session in the project to change them — "add that to the
project instructions", "drop the British English rule" — and it rewrites
them, showing the change as a diff in the transcript. It only edits them
when you ask; nothing is recorded there off its own back.

### Project memories

A memory is either workspace-wide or scoped to a project. A session outside
a project sees and saves workspace memories; a session inside one sees those
*and* the project's own, and anything it saves belongs to that project — the
fact reaches every session in the project and nothing else. Project memories
are curated on the project's page, and names only have to be unique within
their scope, so a project can hold its own `deploy-window` without
disturbing the workspace's.

### Lifecycle and boundaries

- Deleting the **project** deletes everything it contains — its articles,
  its memories, its sessions, and everything those sessions own — behind a
  confirmation that states the counts.
- [Delegated workers](/docs/sessions#delegating-research) inherit both
  records read-only: a worker can consult the corpus and recall memories
  while researching, but only the conversation you're actually in ever
  writes, saves, or deletes.
