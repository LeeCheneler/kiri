# Worktrees

A git worktree is a second checkout of the same repo, on its own branch, in
its own directory — so a new piece of work doesn't disturb the checkout you're
sitting in. Kiri finds the worktrees you already have across your repos,
creates new ones with their dependencies and env files ready to go, and tears
them down again when the work is done.

Point kiri at the folders your repos live in:

```yaml
# kiri.yaml
worktrees:
  roots:
    - ~/projects/personal
  defaults:
    prepare:
      env: symlink # symlink | copy | omit to leave env files alone
      postCreate:
        - mise trust # so mise-shimmed tools resolve for the install below
      install: auto # auto | off
  repos:
    kiri: # keyed by the repo's directory name
      prepare:
        postCreate:
          - mise trust
          - ./scripts/bootstrap.sh
```

Without a `worktrees:` section there's nothing to scan, so the feature stays
out of the way entirely.

## Roots and discovery

Each entry in `roots:` is scanned **one level deep**: if the root is itself a
git repo it's the only candidate, otherwise its immediate children are. There
is no recursion — a folder of projects is the shape this expects, and a deep
scan of your home directory is not. Entries resolve against the workspace
root, a leading `~` expands to your home directory, and absolute paths work as
written.

Repos are grouped by the git directory they share, so a repo reachable from
two roots appears once, and a linked worktree living somewhere outside the
roots still shows up under the repo it belongs to. Each repo reports its
primary checkout — the original clone, where the real `.git` lives — plus
every linked worktree with its branch, whether it has uncommitted changes, how
far ahead or behind its upstream it is, whether that upstream has gone, and
whether git has it locked.

Reading this is read-only and never fetches: it's `git worktree list`, `git
status`, and `git rev-list` against what's already on disk. Anything kiri does
itself updates the view live, as does a worktree directory appearing or
vanishing under a root. Work you do *inside* a repo — a commit, an edit —
doesn't announce itself, so refresh to pick up dirty and ahead/behind state.
Config is re-read as the view loads, so an edit to `worktrees:` applies without
a restart.

## Preparing a new worktree

Creating a worktree takes a **name** and a **branch**. The worktree lands
beside the repo's primary checkout as `<repo>-<name>`; the branch is checked
out if it already exists locally, tracked if it exists on origin, and
otherwise created from a base ref — the repo's default branch on origin unless
you name another. If you don't give a name, the branch's slashes are flattened
into one (`feat/thing` → `feat-thing`).

The repo's prep pipeline then runs, in this order, stopping at the first
failure:

1. **Env files.** `env: symlink` links each of the primary checkout's
   git-ignored `.env` / `.env.*` files into the same relative path in the new
   worktree, so the value is shared — edit it once and every worktree sees it.
   `env: copy` copies them instead, for per-worktree values. Omit `env`
   entirely and env files are left alone. Only files git actually ignores are
   touched; a tracked `.env.example` is already in the checkout.
2. **Post-create commands.** Each string in `postCreate:` runs in the new
   worktree, in order, through your shell with kiri's environment. This is the
   make-it-ready hook, which is why it runs before the install: a
   `postCreate: ["mise trust"]` in `defaults` makes every tool-version-managed
   repo work generically, since the install below resolves its package manager
   through the shims that command just authorised.
3. **Install.** With `install: auto` (the default), every directory in the new
   worktree carrying a lockfile gets one install with the matching package
   manager — `pnpm-lock.yaml`, `yarn.lock`, `package-lock.json`, or bun's
   lockfile — so a monorepo's packages are all covered. `install: off` skips
   it.

You get a per-step report of what ran and what it did. A prep failure leaves
the worktree on disk with the report attached, so you can fix the cause and
carry on rather than starting over. Prep is governed entirely by config —
`defaults.prepare` for every repo, deep-merged field-by-field with the
`repos:` entry keyed by the repo's directory name.

Since `postCreate` commands and installs run as you, with your PATH and your
tooling, treat them like any script in your repo: `kiri.yaml` is a file you
review and commit.

## Removing and pruning

Removing a worktree deletes its directory, then tidies up after it:

- A worktree with **uncommitted changes is refused** unless you force it —
  forcing discards that work for good.
- **Env symlinks are unlinked, not followed**, so the primary checkout's env
  files survive.
- The stale admin entry is pruned, and the primary checkout is
  fast-forwarded when it's sitting on the default branch with an origin
  remote.
- The worktree's **branch is deleted** with `-D` (squash merges mean git
  rarely sees a branch as merged) and the sha it pointed at is reported, so an
  accidental removal is recoverable with `git branch <name> <sha>`.
- The **primary checkout is never removed**, and the **default branch is never
  deleted** — it's left in place with a note.

A failed pull or an undeletable branch is a warning, not a failed removal: the
worktree is gone either way and the note tells you what to sort out by hand.

**Pruning** is separate housekeeping — clearing the records git still holds for
worktrees whose directories are already gone (deleted outside kiri, say). It
removes no directory and touches no branch, and only comes up when a repo
actually has stale entries.
