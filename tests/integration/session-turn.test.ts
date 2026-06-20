import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UIMessage } from "ai";
import { bootstrap } from "../../src/server/bootstrap.ts";
import { createConfigStore } from "../../src/server/config/store.ts";
import type { KiriDb } from "../../src/server/db/index.ts";
import {
  type LlmClients,
  createLlmClients,
  createLlmProviderRegistry,
  loadLlmProviders,
} from "../../src/server/llm/index.ts";
import { createCancelRegistry } from "../../src/server/runner/cancel-registry.ts";
import {
  createSession,
  createSystemPromptBuilder,
  getSession,
  getSessionMessages,
  runTurn,
  updateSessionPersona,
} from "../../src/server/sessions/index.ts";
import { type FakeOpenAi, startFakeOpenAi } from "../support/fake-openai.ts";

/**
 * Integration coverage for session turns over the *real* streaming stack:
 * `runTurn` → `streamText` → an OpenAI-compatible SSE endpoint → persistence.
 * The route/turn unit tests drive `MockLanguageModelV3` in-process, so this is
 * the only layer that exercises the streamed wire format — and the
 * `include_usage` wiring that otherwise leaves streamed turns with zero tokens.
 */
describe("session turn streaming", () => {
  let fake: FakeOpenAi;
  let cwd: string;
  let db: KiriDb;
  let llmClients: LlmClients;

  beforeAll(() => {
    fake = startFakeOpenAi();
  });

  afterAll(() => {
    fake.stop();
  });

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "kiri-int-turn-"));
    db = bootstrap(createConfigStore(cwd));
    writeFileSync(
      join(cwd, "llm-providers.yaml"),
      `providers:\n  fake:\n    type: openai-compatible\n    base_url: ${fake.url}\n`,
    );
    const loaded = loadLlmProviders(createConfigStore(cwd), process.env);
    const registry = createLlmProviderRegistry();
    registry.replace(loaded.providers);
    llmClients = createLlmClients(registry, process.env);
  });

  afterEach(() => {
    db.$client.close();
    rmSync(cwd, { recursive: true, force: true });
  });

  const userMessage = (text: string): UIMessage => ({
    id: crypto.randomUUID(),
    role: "user",
    parts: [{ type: "text", text }],
  });

  const assistantText = (parts: unknown): string =>
    (parts as Array<{ type: string; text?: string }>)
      .filter((p) => p.type === "text")
      .map((p) => p.text ?? "")
      .join("");

  it("streams a turn, persisting the user + assistant messages and usage, and settles idle", async () => {
    const session = createSession(db, "fake:echo");

    const { done } = await runTurn(
      { db, llmClients },
      { session, userMessage: userMessage("Hi there") },
    );
    await done;

    const messages = getSessionMessages(db, session.id);
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(assistantText(messages[1].parts)).toBe("You said: Hi there");
    // Per-message usage is recorded on the assistant turn.
    expect(messages[1].usage).toMatchObject({ inputTokens: 12, outputTokens: 8, totalTokens: 20 });

    const after = getSession(db, session.id);
    expect(after?.status).toBe("idle");
    expect(after?.finishedAt).toBeNull();
    // Running totals are denormalised onto the session row from the streamed
    // `include_usage` chunk — the whole point of the openai-compatible wiring.
    expect(after).toMatchObject({ inputTokens: 12, outputTokens: 8, totalTokens: 20 });
  });

  it("composes the layered system prompt — core, kiri.md, persona — and sends it to the model", async () => {
    writeFileSync(join(cwd, "kiri.md"), "Always answer in British English.");
    mkdirSync(join(cwd, "personas"), { recursive: true });
    writeFileSync(join(cwd, "personas", "pirate.md"), "Talk like a pirate.");
    const session = updateSessionPersona(db, createSession(db, "fake:echo").id, "pirate");

    const { done } = await runTurn(
      { db, llmClients, buildSystemPrompt: createSystemPromptBuilder(createConfigStore(cwd)) },
      { session, userMessage: userMessage("hi") },
    );
    await done;

    const sent = fake.requests[fake.requests.length - 1];
    const system = sent?.messages?.find((m) => m.role === "system");
    const systemText = typeof system?.content === "string" ? system.content : "";
    // All three layers reached the model, in order: core → kiri.md → persona.
    expect(systemText).toContain("running inside kiri");
    expect(systemText).toContain("Always answer in British English.");
    expect(systemText).toContain("Talk like a pirate.");
    expect(systemText.indexOf("running inside kiri")).toBeLessThan(
      systemText.indexOf("Always answer in British English."),
    );
    expect(systemText.indexOf("Always answer in British English.")).toBeLessThan(
      systemText.indexOf("Talk like a pirate."),
    );
    // The turn still completed normally with the system prompt in place.
    expect(getSession(db, session.id)?.status).toBe("idle");
  });

  it("accumulates running token totals across turns", async () => {
    const session = createSession(db, "fake:echo");

    await (await runTurn({ db, llmClients }, { session, userMessage: userMessage("one") })).done;
    const mid = getSession(db, session.id);
    if (!mid) throw new Error("session vanished");
    await (await runTurn({ db, llmClients }, { session: mid, userMessage: userMessage("two") }))
      .done;

    const after = getSession(db, session.id);
    expect(after).toMatchObject({ inputTokens: 24, outputTokens: 16, totalTokens: 40 });
    expect(getSessionMessages(db, session.id)).toHaveLength(4);
  });

  it("records a turn that the provider errors as failed, with the message and no assistant reply", async () => {
    const session = createSession(db, "fake:boom");

    const { done } = await runTurn({ db, llmClients }, { session, userMessage: userMessage("hi") });
    await done;

    const after = getSession(db, session.id);
    expect(after?.status).toBe("failed");
    expect(after?.finishedAt).not.toBeNull();
    expect((after?.error as { message: string }).message).toBeTruthy();
    // The user message is persisted before streaming; the failed turn adds no
    // assistant message.
    expect(getSessionMessages(db, session.id).map((m) => m.role)).toEqual(["user"]);
  });

  it("lands a cancelled turn as cancelled and leaves the session resumable", async () => {
    const cancelRegistry = createCancelRegistry({ sigkillDelayMs: 50 });
    const session = createSession(db, "fake:slow");

    const { done } = await runTurn(
      { db, llmClients, cancelRegistry },
      { session, userMessage: userMessage("take your time") },
    );
    // The slow model holds the stream open (a lead pause then word-by-word), so
    // the cancel lands mid-flight.
    expect(cancelRegistry.requestCancel(session.id)).toBe(true);
    await done;

    const cancelled = getSession(db, session.id);
    expect(cancelled?.status).toBe("cancelled");
    expect(getSessionMessages(db, session.id).map((m) => m.role)).toEqual(["user"]);

    // A cancelled session accepts the next message and runs it clean.
    const resumed = getSession(db, session.id);
    if (!resumed) throw new Error("session vanished");
    await (
      await runTurn(
        { db, llmClients },
        { session: resumed, userMessage: userMessage("back again") },
      )
    ).done;
    const after = getSession(db, session.id);
    expect(after?.status).toBe("idle");
    expect(after?.error).toBeNull();
    expect(getSessionMessages(db, session.id).map((m) => m.role)).toEqual([
      "user",
      "user",
      "assistant",
    ]);
    // The `slow` model's lead pause plus the follow-up turn run past the default
    // per-test budget on a loaded machine; give it headroom.
  }, 15_000);
});
