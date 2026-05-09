# Kiri

**キリト** — short for Kirito, the protagonist of *Sword Art Online*.

A local-first, git-based workflow orchestrator for personal automation. MCP-first so AI agents can drive it as a primary interaction model, with an activity feed as the main UI surface instead of a node-graph canvas.

## Getting started

### Prerequisites

- [mise](https://mise.jdx.dev) — manages the Bun version pinned in `mise.toml`. Activate it in your shell (`eval "$(mise activate zsh)"`) so `bun` resolves to the project-pinned version automatically when you `cd` into the repo.
- [Claude Code CLI](https://docs.claude.com/en/docs/claude-code) — required for any workflow using the `claude-code` bundle (including the bundled `kiri-self-review` dogfood). `claude` must be on your `PATH` and signed in.

### Install

```sh
mise install   # installs Bun at the version pinned in mise.toml
bun install    # installs project deps; also runs lefthook install via prepare
```

### Dev

```sh
bun dev
```

Runs Vite (UI, HMR) and Hono (API) concurrently. Visit **http://localhost:5173** — Vite proxies `/api/*` to Hono on `:4242`, so you get a single browser origin, hot reload, and live API calls. Edit anything under `src/client/` and the browser updates without a full reload.

### Production build

```sh
bun build      # builds the SPA into dist/client
bun start      # runs Hono; serves the built SPA + API at :4242
```

In prod, visit **http://localhost:4242** — Hono serves both the SPA and `/api/*` from a single origin.

### Bootstrap a workflow repo

Kiri is designed to live in dedicated repos — `git init` a new directory, `cd` to it, then:

```sh
kiri init
```

This scaffolds `README.md` (DSL reference and IDE/LSP setup), a 2-step `workflows/example.yaml` paired with `prompts/example.tpl`, the `scripts/claude-code/` bundle starter (`run.sh` + `README.md`), and `.kiri/workflow.schema.json` for editor validation. Re-running is safe — existing files are never overwritten, and the schema file is also refreshed on every plain `kiri` launch so it stays in sync after a binary upgrade.

### Dogfood: `example`

Kiri ships with the same 2-step `example` workflow that `kiri init` scaffolds for end users — step 1 echoes a name, step 2 runs `claude` against `prompts/example.tpl` to produce a one-sentence greeting using the `{{KIRI_INPUT}}` substitution. The kiri repo runs as a consumer of its own init output, so the example workflow is the end-to-end smoke test for the `claude-code` bundle.

1. `bun dev` and open the local URL.
2. Find **example** in the workflow list and click **Run**.
3. Refresh the feed. Click the new entry to expand it — you'll see the snapshotted bundle under *materials*, the agent's final message under the step's *output*, and full envelope traces alongside.

The bundle defers tool permissions to your `~/.claude/settings.json`. If `claude` isn't on your `PATH` or you're not signed in, the run is marked failed and the underlying error is visible in the expanded entry.

### Quality gates

```sh
bun lint       # biome check
bun format     # biome format --write
bun typecheck  # tsc --noEmit
bun test       # bun:test with 100% coverage threshold (enforced via bunfig)
```

`bun lint` and `bun typecheck` also run on every commit via lefthook's pre-commit hook.

### Database schema

Schema lives in `src/server/db/schema.ts`. Migrations are generated via drizzle-kit and applied automatically on kiri startup — end users never run them.

To evolve the schema:

1. Edit `src/server/db/schema.ts`
2. Run `bun db:generate` — produces a new SQL file in `drizzle/`
3. Commit the new migration alongside the schema change

## Layout

```
bin/kiri.ts            entry point — boots Hono
src/server/            Hono app + tests
src/client/            Vite + React SPA (kebab-case filenames)
docs/                  design notes & milestones — read these before substantive work
.kiri/                 repo-scoped runtime state (gitignored, created on launch)
```

See `docs/design-notes.md` for architecture and `docs/milestones.md` for the M0 → M6 build sequence.
