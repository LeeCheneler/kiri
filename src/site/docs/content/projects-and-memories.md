# Projects & memories

Sessions end; what they learned shouldn't. Kiri keeps two kinds of durable
record across conversations: **memories** — small facts the assistant
recalls everywhere — and **projects** — named containers where a body of
work builds a shared corpus of articles. Both live in kiri's local database,
not your repo.

## Memories

A **memory** is a durable fact the assistant carries across sessions — a
preference, standing context, a correction worth keeping. Tell kiri to
remember something and it saves the fact; every later session can recall it,
loading the full text only when it looks relevant. Saving an existing
memory's name rewrites it in place — correct a misunderstood memory by
explaining what it got wrong.

The **Memories page** is where you curate the record: read, edit, and delete
what's wrong or stale. The memory tools run without prompting by default —
that page is your standing oversight — and can be set to Ask or Off like any
[other tool](/docs/sessions#tool-permissions).

## Projects

A **project** is a named container for a body of work: a shared corpus of
articles, a task list, and the sessions that build both. Create one from the
Projects page and start sessions inside it — a session belongs to a project
from creation or not at all.

### The shared corpus

Every article a project session writes lands in the project rather than in
any one conversation. Each session sees the corpus index, reads any article
on demand, and keeps existing ones current, whoever wrote them.

- Articles cross-reference each other with `[[slug]]`, rendering as links in
  the project's reading view and chat — the corpus browses like a small
  wiki, and the assistant cross-links as it writes.
- Corpus articles outlive the sessions that wrote them — deleting a session
  never touches the corpus.

### Project instructions

A project carries its own **standing instructions**: markdown written on the
project page and layered into every session in the project (see
[Shaping behaviour](/docs/sessions#shaping-behaviour)). Edit them any time —
or ask a session in the project to change them ("add that to the project
instructions") and it rewrites them, showing the change as a diff. It only
edits them when you ask.

### Project tasks

A project keeps a **task list**: a checklist of tasks filed under named
groups — "Now", "Backlog", whatever fits the work — with an optional note on
each. You and the project's sessions manage the same list: add and tick off
tasks on the project page, or ask a session ("track that", "mark the docs
done", "move it to Later") and it adds, updates, moves, and reorganises through
its task tools. A session's instructions carry only the list's size; the list
itself loads when the conversation needs it.

Long-lived projects accumulate finished groups. **Hide** a group and it drops
behind a toggle on the page — and out of sessions' view entirely: hidden
groups don't list, don't count, and only you can bring them back from the
page. The Projects index shows each project's open-task count.

### Project memories

A memory is either workspace-wide or scoped to a project. A session inside a
project sees both and saves to the project — the fact reaches every session
in the project and nothing else. Project memories are curated on the
project's page.

### Lifecycle and boundaries

- Deleting a **project** deletes everything it contains — articles,
  memories, tasks, sessions — behind a confirmation that states the counts.
- [Delegated workers](/docs/sessions#delegating-research) inherit the
  records read-only: they can consult the corpus, recall memories, and read
  the task list, but only the conversation you're in ever writes.
