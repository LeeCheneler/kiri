# Contributing to Kiri

Setup, development workflow, and deploy steps for working on kiri itself. For *using* kiri, see the [README](./README.md).

## Prerequisites

- [mise](https://mise.jdx.dev) — manages the Bun version pinned in `mise.toml`. Activate it in your shell (`eval "$(mise activate zsh)"`) so `bun` resolves to the project-pinned version automatically when you `cd` into the repo.
- [Claude Code CLI](https://docs.claude.com/en/docs/claude-code) — required for any workflow using the `claude-code` bundle (including the bundled `example` dogfood). `claude` must be on your `PATH` and signed in.

## Install

```sh
mise install   # installs Bun at the version pinned in mise.toml
bun install    # installs project deps; also runs lefthook install via prepare
```

## Dev

```sh
bun dev
```

Runs Vite (UI, HMR) and Hono (API) concurrently. Visit **http://localhost:5173** — Vite proxies `/api/*` to Hono on `:4242`, so you get a single browser origin, hot reload, and live API calls. Edit anything under `src/client/` and the browser updates without a full reload.

## Production build

```sh
bun build      # builds the SPA into dist/client
bun start      # runs Hono; serves the built SPA + API at :4242
```

The canonical user URL is `https://local.kiri.build` (the Pages-hosted shell). For local testing of the built SPA without going through the hosted shell, use `http://localhost:4242` directly.

## Dogfood: `example`

Kiri ships with the same 2-step `example` workflow that `kiri init` scaffolds for end users — step 1 echoes a name, step 2 runs `claude` against `prompts/example.tpl` to produce a one-sentence greeting using the `{{KIRI_INPUT}}` substitution. The kiri repo runs as a consumer of its own init output, so the example workflow is the end-to-end smoke test for the `claude-code` bundle.

1. `bun dev` and open the local URL.
2. Find **example** in the workflow list and click **Run**.
3. Refresh the feed. Click the new entry to expand it — you'll see the snapshotted bundle under *materials*, the agent's final message under the step's *output*, and full envelope traces alongside.

The bundle defers tool permissions to your `~/.claude/settings.json`. If `claude` isn't on your `PATH` or you're not signed in, the run is marked failed and the underlying error is visible in the expanded entry.

## Tests

Server tests live next to source as `*.test.ts`. Client component tests live next to source as `*.test.tsx` and run in `bun:test` against a `happy-dom` DOM environment with `@testing-library/react` for rendering and queries. HTTP is mocked via [MSW](https://mswjs.io) — handlers default to empty registry/feed responses; per-test overrides go through `server.use(...)`. The setup wiring lives under `tests/setup/` and is hooked in via `bunfig.toml`'s `preload` list so a single `bun test` covers both surfaces.

### End-to-end

Browser-driven golden-path tests live under `tests/e2e/`, run by Playwright (Chromium only). `bun run test:e2e` builds the SPA, boots a fresh kiri against the seeded fixture at `tests/e2e/fixture/`, and drives a real browser through the critical flow. CI runs them as a separate `e2e` job after the unit job passes. The fixture's `.kiri/` is wiped and `dist/` symlinked into place at boot, so every run starts from a clean state DB. Port `4242` is hardcoded — stop any local kiri before running.

## Quality gates

```sh
bun lint       # biome check
bun format     # biome format --write
bun typecheck  # tsc --noEmit
bun test       # bun:test with 100% coverage threshold (enforced via bunfig)
```

`bun lint` and `bun typecheck` also run on every commit via lefthook's pre-commit hook.

## Database schema

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
shell/                 static shell deployed to https://local.kiri.build
docs/                  design notes & milestones — read these before substantive work
.kiri/                 repo-scoped runtime state (gitignored, created on launch)
```

See `docs/design-notes.md` for architecture and `docs/milestones.md` for the build sequence.

## Deploying the shell at `https://local.kiri.build`

The Pages-hosted shell is a hand-maintained `shell/index.html` that loads kiri's bundle from `http://127.0.0.1:4242`. Pages serves only the shell; kiri itself stays plain HTTP on `127.0.0.1`.

### Deploys

Automatic. `.github/workflows/cd.yml` runs `wrangler pages deploy` on every push to `main`. `shell/_headers` caps the shell index at `max-age=300`, so a deploy reaches users within ~5 minutes regardless of edge cache state.

To preview a shell change locally before merging, `bunx wrangler pages deploy --branch=preview` from a checkout of the branch (requires `bunx wrangler login` once per machine).

### One-time setup

**Bootstrap the Pages project (CLI).** Cloudflare doesn't auto-create Pages projects on deploy, and creating one via the dashboard requires uploading an initial artefact. Easiest path is to bootstrap from your machine — this creates the project on first run, ships the initial deploy, and CI takes over for subsequent deploys.

```sh
bunx wrangler login                                       # once per machine
bunx wrangler pages deploy ./shell \
  --project-name=local-kiri-build \
  --branch=main
```

**Attach the custom domain (Cloudflare dashboard).** Pages project → `local-kiri-build` → Custom domains → Set up a custom domain → `local.kiri.build`. Pages auto-provisions the DNS record and TLS cert. (Allow up to ~15 min for cert provisioning + DNS propagation.)

**Add repo secrets (GitHub repo settings → Secrets and variables → Actions).**

- **Secret** `CLOUDFLARE_API_TOKEN` — a custom API token (Cloudflare dashboard → My Profile → API Tokens → Create Token → Custom token). Permission: `Account → Cloudflare Pages → Edit`. Account resources: include the account that owns the Pages project. Zone resources: irrelevant for Pages, leave as default. *Do not use the "Edit Cloudflare Workers" template* — it omits the Pages permission.
- **Variable** `CLOUDFLARE_ACCOUNT_ID` — the account ID visible on the Cloudflare dashboard sidebar. Stored as a repository *variable* (not a secret); it's an identifier, not a credential.
