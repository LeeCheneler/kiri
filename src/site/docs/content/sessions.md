# Have a conversation

A session is a conversation with Kiri's assistant. Use one to think through
a decision, research a question, draft a document, or make a code change.
[Connect a model](/docs/getting-started) first.

## Start with the work

Click **+ New session** (or press **⌥⌘N**), choose a model, and describe what
you need. For example:

> I'm planning an app for tracking the northern lights. Help me decide what
> belongs in the first version and what can wait.

Follow up, correct assumptions, and ask for changes. You can switch models
mid-conversation; the next reply uses your selection.

Use **+ add file** to attach text files, images, or documents — PDFs reach
most hosted models, Office files reach Codex — or paste an image if your model
supports it. To let Kiri explore a folder or change code, first
[enable file access](/docs/working-with-files). Web search and other external
tools need a [connected MCP server](/docs/session-reference#tools-from-mcp-servers).

## Articles

An article is a saved page you can read outside the conversation. When you
have a useful conclusion, ask:

> Write our decision up as an article, including the trade-offs.

Open it from the conversation or activity feed. Articles can include charts
and diagrams. Ask for changes in the session and Kiri updates the page.
The assistant can also save substantial conclusions when they'll be useful
later. An ordinary conversation or code change needs no extra document.

The sidebar lists articles this session has created or edited, with its latest
write first. It stays hidden until there is an article to show; merely reading
an article does not add it. On smaller screens, open **Articles** in the session
header to see the same list. A project's complete shared collection remains on
its project page. Older project articles appear in a session's list after that
session next edits them.

![A Kiri session saving a forecast-model decision as an article and a memory](/screenshots/session.png)

## Session details

Open **Details** in the session header to rename the session, see its working
directory and worker history, or move or delete it. Running workers and workers
waiting for approval also appear in the sidebar; settled workers stay in Details.
Context usage and model-provider notices appear beside the message composer.

## Finding prior work

Press **⌘K** to search your saved work, or ask the assistant:

> What did we decide about the forecast model? Link me to the original answer.

The assistant can search saved conversations, articles, and memories, then
read the relevant passages. In a project, it searches that project by default.
Ask it to look across the workspace when the answer is elsewhere.

## Continue later

Sessions stay in your activity feed. Leaving or reloading the page during a
reply releases its live connection, not the assistant's work. Reopen the
session to rejoin saved and live progress. Keep Kiri running; use cancellation
to stop a turn. If a reply fails, saved progress remains.
See [Troubleshooting](/docs/troubleshooting#a-session-failed-after-doing-some-work)
if you need to recover unfinished work.

For a longer-running effort, [create a project](/docs/projects-and-memories)
so its sessions share saved pages, instructions, and memories.

## Go further

- [Work with files](/docs/working-with-files) — read, edit, and run commands.
- [Create a workflow](/docs/workflows) — automate a task when you want to repeat it.
- [Session reference](/docs/session-reference) — tools, permissions, instructions, and limits.
