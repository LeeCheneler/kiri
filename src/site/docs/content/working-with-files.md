# Work with files

Give Kiri access to a folder so it can read notes, explore a codebase, make
edits, and run commands. Start with [a configured model](/docs/getting-started).

## Choose a folder

Add this to your workspace's `kiri.yaml`:

```yaml
filesystem:
  allowed_directories:
    - .
```

The dot means the workspace folder. To work elsewhere, list that folder
instead, such as `~/projects/aurora`. Changes to `kiri.yaml` apply without
restarting Kiri.

This enables file and shell tools. File reads are allowed within the chosen
directories; changes and shell commands ask for approval by default.
Shell commands run as your user: the directory setting controls where a
command starts, not everything it can touch.

## Ask about the files

Start a session and try:

> Read this project's README and code. Explain how it works, and point out
> which parts of the plan are already implemented.

For a non-code folder, ask Kiri to compare notes or summarise a document.
It can search and read the files directly; you don't need to attach each one.

## Review a change

Ask for a specific edit:

> Update the README with the setup steps you found. Show me the change.

File changes appear as diffs for your approval. Approve the change to apply
it, or deny it and explain what you want instead. Commands also show what
will run before you approve them. You can manage defaults in **Tools & MCP**.

## Set useful instructions

Put workspace-wide preferences in `kiri.md`, for example:

```markdown
Use British English. Keep explanations concise.
Before changing code, read the relevant files and run appropriate checks.
```

Kiri also follows applicable `AGENTS.md` files in the directories it works in.
Projects can carry [their own instructions](/docs/projects-and-memories#project-instructions).

For exact boundaries and shell options, see
[Working with your files](/docs/session-reference#working-with-your-files) and
[Running shell commands](/docs/session-reference#running-shell-commands).
