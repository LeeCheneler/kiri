# Projects & memories

Use a project for work that spans several conversations. Its sessions share
saved articles, instructions, memories, and a task list.

## Projects

Create a project from **Projects**. Open it, then click **+ New session** to
start a conversation inside it. Sessions belong to a project from creation;
existing standalone sessions cannot be moved into one.

For example, keep the planning, forecast-model decisions, and implementation
of an aurora app in one project.

![The Aurora project with related sessions and saved decisions side by side](/screenshots/project.png)

### The shared corpus

Articles written in a project become shared pages. A new session can read
and update them, so you can ask:

> Read our forecast-model decision and help me plan the next implementation step.

The assistant can link related pages with `[[wiki-links]]`. Those links resolve
inside their own article collection. Workflow articles live separately and can
be linked by their normal URLs. Project articles survive deleting the session
that wrote them.

### Project instructions

Use the project's **Instructions** tab for context every session should have:

> This is a personal weekend project. Prefer a small first version and keep
> a record of decisions that affect the forecast model.

Edit instructions yourself, or ask a project session to update them. The
assistant only changes them when asked and shows the diff.

### Project tasks

Track work on the project page, or ask a session:

> Add a task to validate the forecast against a week of observations.

Organise tasks into groups such as Now and Later. Hide finished groups when
you no longer need them; hidden groups are also hidden from sessions until
you restore them on the page.

## Memories

Memories keep useful facts and preferences across sessions. Ask:

> Remember that our forecast data updates every five minutes.

The assistant can also remember stable facts or corrections when useful.
Read, edit, or delete them on the **Memories** page. Correct an existing fact
by telling the assistant what changed. Memory changes are allowed by default;
you can change this in [tool permissions](/docs/session-reference#tool-permissions).

### Project memories

A project session saves memories to that project. It can recall its project
memories and workspace-wide memories. Manage project memories in the project's
**Memories** tab.

### Finding knowledge across sessions

Ask what you decided earlier and Kiri can find the original source. Search
starts in the current project; explicitly ask to search the workspace when
relevant work is elsewhere. Project scope is a default, not an access boundary.
See [knowledge retrieval details](/docs/session-reference#finding-prior-work).

### Lifecycle and boundaries

Deleting a project deletes its sessions, articles, memories, and tasks after
confirmation. These records live in Kiri's local database, outside git.
[Delegated workers](/docs/session-reference#delegating-research) can read project
records; the parent session makes shared-record changes.
