# Worktrees

A git worktree is a second checkout of the same repo, on its own branch, in
its own directory — so a new piece of work doesn't disturb the checkout you're
sitting in. Kiri finds the worktrees you already have across your repos,
creates new ones with their dependencies and env files ready to go, and tears
them down again when the work is done.

Point kiri at the folders your repos live in:

```yaml
# kiri.yaml
git:
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

Without a `git:` section there's nothing to scan, so the feature stays
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
status`, and `git rev-list` against what's already on disk — talking to a
remote is something you ask for (see below). Kiri keeps the
result in memory and rescans in the background, so the page appears at once
rather than waiting on git — it tells you when it was last scanned, and a scan
in progress says so. Anything kiri does itself updates the view live, as does a
worktree directory appearing or vanishing under a root, and an edit to `git:`
in `kiri.yaml` re-resolves the roots and rescans without a restart. Work you do
*inside* a repo — a commit, an edit — doesn't announce itself, so it reconciles
on the next scan.

## Updating

Because reading never fetches, how far ahead or behind a checkout is measured
against remote-tracking refs that are only as current as the last time you
fetched — a checkout can read as level while being twenty commits behind.
**Update** is what makes that honest, and it's one action rather than two:
`git fetch --prune` for the repo, then `git pull --ff-only` for every checkout
of it that can take one. Nothing runs on a timer, and nothing runs while the
app is closed.

One fetch covers every worktree of the repo, since they share an object store,
and the prune is what turns the upstream of a branch deleted on the remote into
`[gone]`. The primary checkout is updated along with the rest: moving the
branch your worktrees were cut from is the point. Each repo says when it last
heard from its remote, read from git's own `FETCH_HEAD` — so it counts a fetch
you ran in a terminal too, and a repo that has never fetched says so rather
than looking current.

You can update one repo from its own page, or every discovered repo at once
from the list. **Update all** is a single request — it runs several repos at a
time and reports back when the whole set has settled. One repo being
unreachable never stops the rest.

The pull is `--ff-only`, and never anything else. A checkout that can't be
fast-forwarded is left exactly as it was and says why:

- the working tree has **uncommitted changes** — commit or stash them first;
- the branch has **no upstream**, or its upstream has **gone**;
- the branch has **diverged** — it's ahead of its upstream as well as behind.
  Since the fetch has just made the upstream current, the refusal also says
  whether reconciling would actually conflict, and in which files;
- **HEAD is detached**, so there's no branch to move.

Kiri won't merge, rebase, stash, or force anything to get past those. It
reports what's in the way and stops; you resolve it in a terminal.

**An update that works says nothing.** What it moved is already in the ahead
and behind counts, and the checkouts it brought current simply stop being
behind. Only what it could *not* do is reported, on the card of the repo or
checkout it concerns, with kiri's reason or git's own message — because a repo
that failed to fetch looks exactly like one that had nothing to fetch. A failed
update — offline, or credentials git can't resolve — is a result, not a broken
page.

## Whether a branch still merges

Merging one pull request can quietly make a sibling worktree unmergeable, and
nothing about ahead/behind hints at it — you find out when a rebase blows up.
A repo's own page answers the question directly: each linked worktree's branch
is merged into the remote default branch (`origin/main`, or whatever yours is)
entirely in git's object store, and one that no longer merges cleanly is tagged
`conflicts main` and names the files it would fight over.

This is a real three-way merge per worktree, far heavier than reading a status,
so it runs for the one repo you're looking at rather than across every repo in
the workspace. What it finds is remembered, so the repo list can show a
`conflicting` count and pull that repo to the front of the list without
re-running the merge — and the answer is dropped, rather than shown stale, once
the branch moves or the repo fetches again.

Nothing is fetched to answer it, so it describes the default branch **as of the
repo's last update**, which is what the wording on the page says. Update the
repo to ask against what everyone else has now.

Some checkouts have no question to answer, and those stay silent rather than
being reported as fine: the primary checkout, a worktree sitting on the default
branch itself, a detached HEAD, and any branch git can't compute a merge for —
unrelated histories, or no `origin/<default>` on disk yet.

Kiri only reports it. Resolving, merging, and rebasing stay in your terminal,
and there's no conflict viewer here.

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

A failed fast-forward or an undeletable branch is a warning, not a failed removal: the
worktree is gone either way and the note tells you what to sort out by hand.

**Pruning** is separate housekeeping — clearing the records git still holds for
worktrees whose directories are already gone (deleted outside kiri, say). It
removes no directory and touches no branch, and only comes up when a repo
actually has stale entries.

## Reviewing changes

Every checkout — the primary and each linked worktree — links through to a
page of its own showing what it has changed, so a branch can be read file by
file without leaving kiri. Where the link lands is decided from what the scan
already knows: a checkout with uncommitted work opens on its working tree,
anything else on what its branch introduces. A clean checkout sitting on the
default branch has nothing either view could show, so it offers no link at
all.

There are two views and nothing between them:

- **Uncommitted** — the working tree against the last commit, including
  untracked files. Staged and unstaged are one view; the index isn't a concept
  this exposes.
- **Branch** — what the branch introduces over the commit it and the default
  branch last had in common. Not what it differs from the branch tip by, and
  not including uncommitted work.

The chosen view lives in the URL, so a branch's changes can be linked to
directly.

Every changed file's diff is on the page at once, one after another, so the
whole changeset reads top to bottom by scrolling. Each file is headed by its
path on one side and what happened to it on the other — the change kind, how
many lines moved, whether it's binary or its patch was cut short — and folds
away once you've read it, keeping that heading either way. Patches are read a
few at a time and each file fills in as its own arrives; in a changeset past
fifty files the rest start folded, so the page still lists everything that
changed and each of those diffs loads when you open it.

Diffs are computed on request rather than kept in the background scan, and
nothing signals when a file changes underneath one. The page says how old the
diff on screen is — `Computed 2 minutes ago`, beside a **Refresh** — so it's
clear whether you need it, the same way the repo pages report their last scan.

When there's nothing to show, the page says which of the reasons applies: the
working tree is clean, the branch introduces nothing, the repo has no default
branch to measure against, the checkout is on the default branch, it shares no
history with the default branch, or it has no commits yet. Very large
changesets stop at 500 files and very large patches are cut short, both
stated rather than silently trimmed, and a binary file reports as binary
rather than showing bytes.

Nothing on this page changes the repository. There's no staging, committing,
discarding, reverting, or editing from a diff — reviewing is all it does.
