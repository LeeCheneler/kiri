# Positioning

The reference for how Kiri describes itself across the site, README, docs,
and onboarding. Lead with what someone can do, then show why the work remains
useful. Technical details belong in guides and reference pages.

## The promise

**An AI workspace for work worth keeping.**

Research, write, and code with an assistant on your machine. Keep useful
answers as pages, carry context between sessions, and turn repeat tasks into
workflows.

Category: **local-first AI workspace**. Supporting facts: open source,
bring your own model, macOS on Apple silicon. Model access is configured
separately; cloud providers and connected tools receive data for their calls.
Never imply that local storage means all processing happens locally.

## What to show

1. **Work through it.** Lead with a real session: a decision, a draft, or a
   code change. Sessions are general-purpose; a repo is one possible workspace.
2. **Keep what matters.** Show the saved decision alongside the conversation
   that produced it, then how another session can find and build on that work.
3. **Run it again.** Show a repeatable task made into a workflow when the user
   wants automation. Workflows run on demand while Kiri is open.

These are capabilities, not a mandatory sequence. A conversation or a code
change is a complete outcome. Articles, memories, and workflows serve the
work; every session does not need to produce all three.

## The homepage

- One headline, one short explanation, and a clear link to the quickstart.
- A large session screenshot directly under the hero, before feature copy.
- Three short benefits, followed by a related project screenshot. Use one
  coherent example so readers see how the conversations and saved work connect.
- A brief explanation of local storage, model choice, and permissions.
- A closing invitation to start a conversation.

Keep the warm dark palette, serif headings, and restrained gold accents.
Use readable prose and real product imagery. Avoid repeating the same feature
set in a grid, long prose sections, and a gallery. Installation commands and
configuration examples live in the quickstart.

## The documentation

- **Start:** a short orientation and an install-to-first-conversation guide.
- **Guides:** practical tasks with examples — conversations, files, projects,
  workflows. Explain only the concepts needed to complete the task.
- **Reference:** configuration, permissions, exact limits, execution semantics,
  and workflow syntax. Preserve useful detail without making it required reading.

Configure the model before launching in the quickstart. The first example
must work with that configuration. File access and automation are separate,
optional guides. Keep existing bookmarks working when moving reference sections.

## Vocabulary

- Use **assistant** for the actor. Prefer “conversation” when introducing
  sessions; reserve “agentic” for technical contexts.
- A saved page is an **article**; short reusable facts are **memories**.
- A **project** brings related sessions, articles, memories, and tasks together.
  Explain that before introducing “corpus” in reference material.
- A **workflow** is a repeatable task run from a button. Introduce YAML when
  someone creates or edits one, not in the homepage headline.
- Use **workspace folder** when a git repository is not required.
- Prefer concrete outcomes to “work compounds”, “powerful”, or “seamless”.
- Avoid blanket claims that other tools forget or that every new session
  starts from zero. Demonstrate what Kiri preserves and how it can be reused.
