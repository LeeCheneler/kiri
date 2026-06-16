# Agentic Sessions — Work Plan

The build sequence for kiri's second pillar: **agentic sessions** (multi-turn agentic chat).
For the design intent — what the pillar *is*, how it relates to workflows, the storage and
execution model — see `docs/design-notes.md` § *Agentic sessions*. This file is the work list:
mini-milestones, the decisions locked early, and the open questions. It is a living document —
keep it in step with reality as milestones land.

## Branching & flow

- All work happens on **feature branches off `agentic-support`** (the long-lived integration
  branch off `main`). Branch naming: `feat/agentic-<slug>` (e.g. `feat/agentic-chat`).
- `agentic-support` is **merged into `main` in one go** once the whole piece is signed off for a
  release — not milestone-by-milestone.
- These planning docs (this file + the `docs/design-notes.md` revisions) are seeded directly on
  `agentic-support` as the shared roadmap every feature branch builds against.
- Each milestone follows the normal kiri ticket discipline (plan → commit list → sign-off →
  atomic commits), per `CLAUDE.md`.

## Decisions locked early

These shape everything and are expensive to reverse, so they are settled up front:

1. **Messages are stored as AI SDK `UIMessage[]` (parts).** Provider-agnostic and canonical.
   Because parts already model tool calls and file/image attachments, tools (Milestone 5) and
   image uploads (Milestone 3) become storage no-ops.
2. **Two transports.** Per-turn token streaming via the AI SDK's streamed response
   (`toUIMessageStreamResponse()` + `@ai-sdk/react`'s `useChat`); coarse `session.*` lifecycle on
   the existing SSE event bus for cache invalidation. **No token deltas through the bus.**
3. **`@ai-sdk/react` `useChat` on the client** drives the chat UI and the streaming protocol.
4. **Usage is first-class for sessions.** Per-message usage *and* a denormalised running token
   total on the `sessions` row — a deliberate divergence from the workflow pillar (which dropped
   its usage column), justified by needing live budget/context visibility.
5. **Feed cursor designed as `(startedAt, id)` from the outset** so a later runs+sessions feed
   union (Milestone 4) is a query change, not a rewrite.
6. **No crossover with workflows.** Separate execution, config, storage, UI. Shared infra and
   feed only. (Reaffirms the design invariant.)

## Milestones

### Milestone 1 — Chat

A working, persisted, streaming multi-turn session against a **single hardcoded agent**
(model only — no YAML config, no tools, no images). This milestone carries the architecture: it
proves the data model, the streaming transport, persistence/replay, and the session UI end to end.

- [ ] **Schema:** `sessions` + `messages` Drizzle tables and migration (register in `migrate.ts`).
      `messages.parts` as `UIMessage` parts JSON; `messages.usage` JSON; `sessions` running token
      total + status + model + timestamps + snapshotted agent config (placeholder for now).
- [ ] **Runtime:** `src/server/sessions/` turn handler calling the LLM provider registry;
      cancellation via `CancelRegistry`; reconcile interrupted sessions on startup (mirror runs).
- [ ] **Routes:** `src/server/routes/sessions.ts` — create session, list/get session(s), and a
      turn endpoint that streams the assistant response and persists messages + usage on finish.
      Mount in `createApp`; apply the same loopback + `X-Kiri-Client` security as other routes.
- [ ] **Events:** `session.*` added to both the server bus union and the client mirror; feed/query
      invalidation wired through `LiveSync`.
- [ ] **Client:** add `@ai-sdk/react`; a sessions feature folder + session page/route; "new session"
      entry point; `useSessions*` state hooks. Compose from the design system.
- [ ] **Tests:** server turn persistence + streaming; client chat flow (accessible queries);
      Playwright golden-path e2e.

Out of scope for M1: YAML agent config, tools, images, and home-feed integration (sessions live on
their own surface until Milestone 4).

### Milestone 2 — Config

Pre-baked **agent definitions in YAML**, selected when starting a session — the
`workflows/*.yaml` pattern applied to `agents/*.yaml`.

- [ ] **Schema:** `agents/*.yaml` Zod schema — name, description, system prompt (inline or file),
      default model (`provider:model`), allowed tools (declared now, enforced at Milestone 5),
      generation params (temperature, max tokens, …). Generate `.kiri/agents.schema.json` for LSP.
- [ ] **Loader/registry/watcher:** copy the workflow machinery (`Bun.YAML.parse` + `safeParse` +
      collect-failures + in-memory registry + `fs.watch`). Bootstrap scaffolds `agents/`.
- [ ] **Snapshot:** resolve and snapshot the agent config onto the `sessions` row at session start
      (mirror `definitionSnapshot`); editing the YAML never mutates an existing session.
- [ ] **UI:** agent picker when starting a session; surface which agent a session used.
- [ ] **Docs:** agent-authoring reference (mirroring the workflow one), JSON schema, and anything
      `kiri init` scaffolds.

Out of scope: enforcing allowed tools, and the tools themselves (Milestone 5).

### Milestone 3 — Image uploads

Send images into a session — **paste and a file uploader** — when the model supports vision.

- [ ] **Composer:** paste handler + file uploader; attach images as file parts on the user message.
- [ ] **Round-trip:** pass file/image parts to the model; gate on model capability (disable the
      affordance when the configured model can't accept images).
- [ ] **Storage:** image parts persist as `UIMessage` parts — no schema change. Decide where bytes
      live (inline base64 vs. on-disk blob in `.kiri/` referenced by path); lean on the
      design-notes disk-blob guidance and defer the split until payload size warrants it.
- [ ] **Capability metadata:** a way to know which models accept images (agent/model config flag or
      provider capability).
- [ ] **Tests.**

## Follow-up work — defined after Milestones 1–3 land

Sketched now for direction; broken into proper milestones once the first three are done and we
know the real shape.

### Milestone 4 — Sessions in the activity feed

Surface sessions alongside workflow runs in the home feed. The decision to make here:

- **Polymorphic union** over `runs` + `sessions` (composite `(startedAt, id)` cursor + a
  discriminated activity-item row + a renderer per kind), **vs. a separate sessions feed.**
- The feed cursor is already being designed as `(startedAt, id)` (decision #5) to keep the union
  option open cheaply.

### Milestone 5 — Tools

Generic agent tools gated by the agent's allowed-tools config. **Begin with read file.**
Tools in general are fleshed out as their own separate effort.

- Start: **read file** — one AI SDK `tool()` with a Zod param schema + `execute`; the SDK drives
  the call/result loop; calls and results persist as `UIMessage` parts (already storable from M1).
- Later, separately: write file, edit file, web search, the *run-a-workflow* bridge tool, and
  possibly MCP. Verify OpenAI tool parity (the provider is on Chat Completions / `.chat()`).

## Open questions

- **Feed model** — union vs. separate sessions feed (resolved at Milestone 4).
- **Image bytes at scale** — inline vs. disk-backed blob, and when to make the split.
- **Context-window management** — truncation/summarisation strategy as sessions grow long; likely
  its own effort after the core pillar is usable.
- **Tool catalogue & trust** — scope beyond read-file, the run-a-workflow bridge, and whether MCP
  is in play; tool execution trust boundary for write-capable tools.
