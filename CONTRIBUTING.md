# Contributing to Kiri

Setup, development workflow, and deploy steps for working on kiri itself. For *using* kiri, see the [README](./README.md).

## Prerequisites

- [mise](https://mise.jdx.dev) — manages the Bun version pinned in `mise.toml`. Activate it in your shell (`eval "$(mise activate zsh)"`) so `bun` resolves to the project-pinned version automatically when you `cd` into the repo.
- [Claude Code CLI](https://docs.claude.com/en/docs/claude-code) — required for any workflow using the `claude-code` example bundle, including the `Daily Briefing` dogfood under `examples/`. `claude` must be on your `PATH` and signed in.

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

## Dogfood

`examples/` is a complete kiri workspace the project keeps as both a reference and a manual smoke test. It carries the four example bundles and one real workflow:

- **Daily Briefing** — `sh:` (curl + jq against the HackerNews and Dev.to APIs) → `claude-code` publish (formats a markdown briefing artefact) → summariser. Exercises the `claude-code` bundle, the publish path, and the summariser end to end.

To smoke-test it, run the orchestrator with `examples/` as its workspace while Vite serves the UI:

1. `vite` — serves the UI on http://localhost:5173.
2. `cd examples && bun --watch ../bin/kiri.ts` — the orchestrator, workspace `examples/`, API on :4242 (Vite proxies to it).
3. Open http://localhost:5173 and click **Run** on Daily Briefing. Refresh the feed, then click the new entry to open the run detail page — the header pins the data-repo git sha (with a dirty marker if the working tree had uncommitted changes), and each step shows its captured output and envelope traces. To reproduce a past run faithfully, `git checkout <sha>` in the data repo.

The `claude-code` bundle defers tool permissions to your `~/.claude/settings.json`. If `claude` isn't on your `PATH` or you're not signed in, runs that use it are marked failed and the underlying error is visible in the expanded entry. Daily Briefing also requires `curl` and `jq`.

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
examples/              reference kiri workspace — example bundles + the dogfood workflow
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

## Releasing

Cutting a release is a two-step ritual: publish a GitHub release, and let CI take over. `.github/workflows/release.yml` runs on `release: published` and:

1. Builds the SPA + overwrites `src/server/embedded-assets.ts` (`bun run build:embed`) so the compiled binary carries the SPA inside itself rather than reaching for `./dist/client` at runtime.
2. Compiles the macOS ARM64 binary with the release tag baked in via `bun build --define KIRI_VERSION=...`, then uploads it as the `kiri` asset on the release.
3. Bumps the Homebrew formula in the `LeeCheneler/homebrew-kiri` tap so `brew upgrade kiri` picks up the new version.

The version baked into the binary is what `kiri --version` reports.

### Verifying the embedded SPA locally

`bun run build:embed` reproduces the CI overwrite, so you can `bun build --compile bin/kiri.ts --outfile /tmp/kiri-test` and run it from a directory with no `dist/client/` to prove the binary serves the SPA from memory. **Do not commit the regenerated `src/server/embedded-assets.ts`** — the main branch keeps the empty stub. After verifying, restore it with `git checkout src/server/embedded-assets.ts`.

### Homebrew tap

The tap lives at [`LeeCheneler/homebrew-kiri`](https://github.com/LeeCheneler/homebrew-kiri) so users can `brew install LeeCheneler/kiri/kiri` (Homebrew auto-taps it on first install). The formula there is auto-bumped by the release workflow on every published release — don't hand-edit it.

The bump job needs the `HOMEBREW_TAP_TOKEN` secret on this repo: a fine-grained personal access token scoped to `LeeCheneler/homebrew-kiri` only, with `Contents: Read and write` permission. The default `GITHUB_TOKEN` can't push across repos, which is why a PAT is required.
