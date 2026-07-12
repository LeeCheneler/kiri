import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UIMessage } from "ai";
import { eq } from "drizzle-orm";
import { bootstrap } from "../../src/server/bootstrap.ts";
import { loadKiriConfig } from "../../src/server/config/loader.ts";
import { createConfigStore } from "../../src/server/config/store.ts";
import type { KiriDb } from "../../src/server/db/index.ts";
import { articles } from "../../src/server/db/schema.ts";
import {
  type LlmClients,
  createLlmClients,
  createLlmProviderRegistry,
} from "../../src/server/llm/index.ts";
import { createCancelRegistry } from "../../src/server/runner/cancel-registry.ts";
import {
  articleTools,
  createSession,
  createSystemPromptBuilder,
  getSession,
  getSessionMessages,
  imageTools,
  runTurn,
  updateSessionImageModel,
  updateSessionPersona,
} from "../../src/server/sessions/index.ts";
import { FAKE_IMAGE_B64, type FakeOpenAi, startFakeOpenAi } from "../support/fake-openai.ts";

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
      join(cwd, "kiri.yaml"),
      `providers:\n  fake:\n    type: openai-compatible\n    base_url: ${fake.url}\n`,
    );
    const loaded = loadKiriConfig(createConfigStore(cwd), process.env);
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
    // The context footprint is recorded on the assistant turn — non-zero only
    // because the openai-compatible client opts into `include_usage`.
    expect(messages[1].contextTokens).toBe(20);

    const after = getSession(db, session.id);
    expect(after?.status).toBe("idle");
    expect(after?.finishedAt).toBeNull();
  });

  it("drives a real tool loop over the wire: the model's call runs an article tool and the turn settles", async () => {
    const session = createSession(db, "fake:tool");
    const tools = articleTools(db, session.id, () => {});

    // The stub's `tool` model streams back exactly the call the message
    // directs, so this exercises the full loop: streamed tool-call chunks →
    // AI SDK parse/validate → the real create_article execute → result fed
    // back → the follow-up completion.
    const { done } = await runTurn(
      { db, llmClients, tools },
      {
        session,
        userMessage: userMessage(
          `call:create_article ${JSON.stringify({ slug: "notes", content_md: "# Notes\n\nBody." })}`,
        ),
      },
    );
    await done;

    const row = db.select().from(articles).where(eq(articles.sessionId, session.id)).get();
    expect(row?.slug).toBe("notes");
    expect(row?.contentMd).toBe("# Notes\n\nBody.");

    const messages = getSessionMessages(db, session.id);
    expect(assistantText(messages[1].parts)).toBe("All done.");
    expect(getSession(db, session.id)?.status).toBe("idle");
  });

  it("drives generate_image over the wire, keeping the image bytes out of the model's context", async () => {
    const session = createSession(db, "fake:tool");
    updateSessionImageModel(db, session.id, "fake:paint");
    const tools = imageTools({ db, sessionId: session.id, llmClients });

    const first = await runTurn(
      { db, llmClients, tools },
      { session, userMessage: userMessage('call:generate_image {"prompt":"a red panda"}') },
    );
    await first.done;

    // The stub generated from the session's selected model with the prompt…
    expect(fake.imageRequests).toMatchObject([{ model: "paint", prompt: "a red panda" }]);

    // …the stored transcript carries the result as a renderable data URL…
    const messages = getSessionMessages(db, session.id);
    const toolPart = (
      messages[1].parts as Array<{
        type: string;
        output?: { image?: string; model?: string; mediaType?: string };
      }>
    ).find((p) => p.type === "tool-generate_image");
    expect(toolPart?.output).toEqual({
      model: "fake:paint",
      mediaType: "image/png",
      image: `data:image/png;base64,${FAKE_IMAGE_B64}`,
    });
    expect(assistantText(messages[1].parts)).toBe("All done.");

    // …and no chat request ever carries the base64 payload: the same-turn
    // follow-up sees toModelOutput's compact form, and the next turn's
    // history is stripped at send time.
    const second = await runTurn(
      { db, llmClients, tools },
      { session: getSession(db, session.id) ?? session, userMessage: userMessage("thanks") },
    );
    await second.done;
    for (const request of fake.requests) {
      expect(JSON.stringify(request)).not.toContain(FAKE_IMAGE_B64);
    }
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

  it("records each turn's context footprint across a multi-turn session", async () => {
    const session = createSession(db, "fake:echo");

    await (await runTurn({ db, llmClients }, { session, userMessage: userMessage("one") })).done;
    const mid = getSession(db, session.id);
    if (!mid) throw new Error("session vanished");
    await (await runTurn({ db, llmClients }, { session: mid, userMessage: userMessage("two") }))
      .done;

    const messages = getSessionMessages(db, session.id);
    expect(messages).toHaveLength(4);
    // Each assistant turn records its own footprint; the latest is what the gauge reads.
    expect(messages[1]?.contextTokens).toBe(20);
    expect(messages[3]?.contextTokens).toBe(20);
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
