# Kiri

**キリト** — short for Kirito, the protagonist of *Sword Art Online*.

A local-first, git-based workflow orchestrator for personal automation. MCP-first so AI agents can drive it as a primary interaction model, with an activity feed as the main UI surface instead of a node-graph canvas.

## Getting started

### Prerequisites

- [mise](https://mise.jdx.dev) — manages the Bun version pinned in `mise.toml`. Activate it in your shell (`eval "$(mise activate zsh)"`) so `bun` resolves to the project-pinned version automatically when you `cd` into the repo.

### Install

```sh
mise install   # installs Bun at the version pinned in mise.toml
bun install    # installs project deps; also runs lefthook install via prepare
```

### Dev

```sh
bun dev
```

Runs Vite (UI, HMR) and Hono (API) concurrently. Visit **http://localhost:5173** — Vite proxies `/api/*` to Hono on `:3000`, so you get a single browser origin, hot reload, and live API calls. Edit anything under `src/client/` and the browser updates without a full reload.

### Production build

```sh
bun build      # builds the SPA into dist/client
bun start      # runs Hono; serves the built SPA + API at :3000
```

In prod, visit **http://localhost:3000** — Hono serves both the SPA and `/api/*` from a single origin.

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
