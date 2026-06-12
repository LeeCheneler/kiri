# Kiri — Working Instructions

Kiri is a local-first, git-based workflow orchestrator for personal automation. See `docs/design-notes.md` for architecture, the design invariants, and the phased build sequence. Read it before doing substantive work.

## Picking up a ticket

When asked to "pick up", "work on", or "start" a ticket (or given a ticket reference like `#12`), follow this workflow exactly. Do not skip the sign-off gates.

### Step 1 — Read the ticket

- Fetch the issue with `gh issue view <number>` (include comments via `--comments` if there's discussion).
- Read every linked design doc, file path, or issue mentioned in the ticket body.
- Cross-reference the design invariants in `docs/design-notes.md` so the work fits the system's constraints.
- If the ticket is ambiguous, ask before planning. Do not guess at intent on tickets.

### Step 2 — Plan the changes

Produce a written plan covering:

- **Goal** — one sentence restating what "done" looks like, in your own words.
- **Approach** — the design choices you're making and *why*. Call out anything that interacts with a design invariant from `docs/design-notes.md`.
- **Files** — paths you expect to create or modify, with a short note on what changes in each.
- **Risks / open questions** — anything you're unsure about, or trade-offs the user should weigh in on.
- **Out of scope** — anything you're explicitly *not* doing in this ticket, especially things a reader might assume are bundled in.

### Step 3 — Present a planned commit list

Each ticket completes in one or many commits. Commits must be atomic (one logical change each) and the codebase must be in a working state after every commit.

For each planned commit, list:

- Conventional-commit subject (e.g. `feat(runner): add script node executor`)
- One-line description of what's in it
- The files it touches

Order commits so the codebase compiles/tests pass after each one. If a commit is just scaffolding, say so.

### Step 4 — Wait for sign off

Stop. Do not start implementing. Wait for the user to approve, amend, or reject the plan. If they amend it, restate the updated plan + commit list and wait again.

## Working through the plan

Once the plan is signed off:

1. Implement the work for the **next commit only**. Do not bundle multiple planned commits together — even if they're small.
2. When the work for that commit is complete, **stop**. Do not run `git commit` yet.
3. Present the changes for review:
   - Summarise what you did in 2–4 bullets (the *why*, not a file-by-file recap of the diff).
   - Show `git status` and `git diff` (staged + unstaged) so the user can review.
   - Note anything that deviated from the planned commit and why.
   - Flag anything you noticed but deliberately did not change (so the user can decide whether it warrants a follow-up).
4. Wait for sign off on the changes.
5. Once signed off, commit using the planned subject (refining the body if useful). Then move to the next planned commit and repeat from step 1.

If during implementation you discover the plan is wrong, **stop and revise the plan**. Don't quietly drift away from what was agreed.

## Keeping documentation in sync

When completing a ticket, before considering it done, sweep the project's documentation surfaces and correct anything the change has made wrong, incomplete, or misleading. Documentation lives in more places than the repo's markdown files — explicitly consider each of these surfaces:

- **CLI help and usage text** — what the binary prints for `--help` and usage errors.
- **The public site deployed to Cloudflare** — the hosted shell and docs pages users browse to.
- **Repo markdown docs** — the project README, the contributor guide, and the architecture/design notes (which also carry the roadmap and design invariants).
- **The workflow-authoring reference for AI assistants** — the standalone guide that teaches an assistant to author workflows for this project.
- **Bundle and script READMEs** — the env-var contract docs shipped alongside each bundle.
- **Anything `kiri init` scaffolds** — the README and starter workflow written into a fresh user repo, plus the generated workflow JSON Schema.
- **Schema descriptions** — the descriptions on the workflow Zod schema, which surface as editor autocomplete and validation hints.
- **In-app UI copy** — documentation links, empty-state explanations, and onboarding or explanatory text rendered inside the app.

Not every change touches every surface, but check each one rather than assuming. Stale documentation is a defect — treat keeping it correct as part of the work, not an afterthought.

Docs describe current behaviour for a reader — **don't reference internal milestone labels** (`M0`, `M1`, …) in them. They're a build-sequence artifact that's meaningless outside the repo's own history; describe the capability, not the milestone it shipped in.

## House rules

- **KISS.** Small functions, simple modules, clear intent. The boring solution is almost always the right one.
- **Match the project.** Follow existing patterns, naming, and file layout. New patterns require justification.
- **Read before writing.** Explore relevant code before changing it.
- **Don't abstract early.** Duplication is fine until the third occurrence in code (or fifth in tests).
- **Let errors bubble.** No defensive try/catch at every call site.
- **Comments.**
  - **Public APIs (exports) get a JSDoc.** Describe the contract: what it does, key params/returns, notable side effects. Keep it tight — usually one or two lines.
  - **Non-obvious logic gets a brief comment.** The *why* — a workaround, subtle constraint, ordering requirement. Don't narrate *what* the code does; names should do that.
  - **Never reference task context in JSDoc or comments.** No issue numbers, PR references, milestone labels (`M0`, `M1`, …), or "added for X / used by Y" callers. That context belongs in the PR description and rots as the codebase evolves. Describe behaviour concretely instead.
- **Bun is the runtime.** Use `bun` (not `node`/`npm`/`pnpm`) for install, run, test, build. `bun:sqlite` for SQLite.
- **Filenames are kebab-case.** Always. No PascalCase or camelCase filenames — even for React components (`app.tsx`, not `App.tsx`). The exported symbol can stay PascalCase; only the filename rule is fixed.
- **No daemons, no overnight execution.** Everything is scoped to "while the app is active." Don't add features that violate this.
- **Definitions are YAML.** Workflow files are YAML validated against a Zod schema (`src/server/workflows/schema.ts`). When in doubt about workflow shape, defer to that schema and `docs/design-notes.md` § Architecture.
- **Build UI from the design system.** Kiri's UI is composed from a clean-room set of foundation tokens (colour, type, status) and presentational primitives in `src/client/design-system/`, catalogued in the dev-only living design system at `/dev/design-system` (`src/client/routes/design-system-page.tsx`). It is the single source of truth for the interface's building blocks. Before designing or building any UI, consult it: read the relevant primitives and their usage guidance, and compose from them. Reach for an existing primitive first — a new pattern earns its place only when nothing there fits, and a genuinely new primitive belongs *in* the design system (component + catalogue entry with variants and usage notes), not hand-rolled inline at the call site.
- **UI test selectors.** Component tests (`@testing-library/react`) and e2e tests (Playwright) target the UI the way a user does — by role, label, and visible text. Default to accessible queries: `getByRole`, `getByLabelText`, `getByText`, `getByPlaceholderText`. They double as accessibility regression tests: if the query can't find the element, the element probably isn't accessible to screen readers either. Test ids (`data-testid`) and class/CSS selectors are escape hatches — use them only when there's no semantic anchor (e.g. a purely decorative wrapper that needs to be asserted on) and prefer adding the missing semantics to the component instead.
- **Don't test static content, styling, or DOM ordering in unit tests.** Aim each assertion at *behaviour* — conditional rendering, state changes, event wiring, async flows — not at what the JSX literally contains. Skip these:
  - **DOM position / sibling order.** No `compareDocumentPosition`, no "X renders above Y" assertions. Layout is owned by JSX and is the e2e/visual surface's job to catch.
  - **CSS class names**, including Tailwind utilities (`text-status-failed`, `bg-accent`, `font-display`, …). Class names churn with styling and aren't meaningful to a user. If the meaning needs to be assertable, expose it as a semantic attribute (`data-status="failed"`, `aria-current="page"`) and assert on that.
  - **Hardcoded decorative text** that's there in every render path. Asserting "the section heading reads 'Activity'" doesn't catch a real regression. Conditional copy (empty state vs populated, error message text, button-label transitions like *copy* → *copied*) **is** behavioural — keep those.
  - **Element-type drills** ("renders an `<h1>` with this class, an `<h2>` with that class, …"). If the component runs you've already got coverage; styling is the design surface's concern.

  In short: if removing the assertion would let a real user-visible regression through, keep it. If it only fails when someone tweaks a Tailwind class or reorders two adjacent sections, drop it.

## Git

- Conventional commits. Subject ≤ 70 chars. Body explains *why*, not *what*.
- Never reference Claude or AI tooling in commit messages, PR descriptions, or code comments.
- Never force-push `main`. Never commit `.env`, secrets, or credentials.
- Never commit without explicit user sign off (see *Working through the plan* above).
- **Never commit directly to `main`** unless the user explicitly tells you to. Ticket work lands via a feature branch and PR. Branch naming: `feat/<issue>-<slug>`, `fix/<issue>-<slug>`, `chore/<slug>`. If you realise you've committed to `main`, stop and offer to move the commits to a branch (`git branch <name> && git reset --hard origin/main`) before pushing anything.
