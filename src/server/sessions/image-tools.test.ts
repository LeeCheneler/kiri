import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolExecutionOptions, ToolSet } from "ai";
import { http, HttpResponse } from "msw";
import { server } from "../../../tests/setup/msw.ts";
import { type KiriDb, openDatabase } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { type LlmProvider, createLlmClients, createLlmProviderRegistry } from "../llm/index.ts";
import { imageTools } from "./image-tools.ts";
import { createSession, updateSessionImageModel } from "./store.ts";

const MODEL = "lmstudio:gemma-4-26b-a4b-qat";

// A 1x1 transparent PNG, so the SDK's media-type sniffing sees real image bytes.
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

// Invoke a tool's execute with a minimal ToolExecutionOptions, casting away
// the union's `never` input so a test can call it plainly.
const run = (t: ToolSet[string], input: unknown): Promise<unknown> =>
  (t.execute as (input: unknown, options: ToolExecutionOptions) => Promise<unknown>)(input, {
    toolCallId: "call-1",
    messages: [],
  } as ToolExecutionOptions);

describe("imageTools", () => {
  let dir: string;
  let db: KiriDb;
  let tools: ToolSet;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kiri-image-tools-"));
    db = openDatabase(join(dir, "state.db"));
    migrate(db);
    createSession(db, MODEL, { id: "s1" });

    const local: LlmProvider = {
      name: "local",
      type: "openai-compatible",
      baseUrl: "http://localhost:1234/v1",
    };
    const registry = createLlmProviderRegistry();
    registry.replace(new Map([[local.name, local]]));
    tools = imageTools({ db, sessionId: "s1", llmClients: createLlmClients(registry, {}) });
  });

  afterEach(() => {
    db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const stubImages = () => {
    let body: unknown;
    server.use(
      http.post("http://localhost:1234/v1/images/generations", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ created: 0, data: [{ b64_json: TINY_PNG_B64 }] });
      }),
    );
    return { requestBody: () => body };
  };

  it("generates an image with the session's selected model, returned as a data url", async () => {
    const stub = stubImages();
    updateSessionImageModel(db, "s1", "local:flux");

    const output = await run(tools.generate_image, { prompt: "a red panda" });

    expect(output).toEqual({
      model: "local:flux",
      mediaType: "image/png",
      image: `data:image/png;base64,${TINY_PNG_B64}`,
    });
    expect(stub.requestBody()).toMatchObject({ model: "flux", prompt: "a red panda" });
  });

  it("forwards a requested size", async () => {
    const stub = stubImages();
    updateSessionImageModel(db, "s1", "local:flux");

    await run(tools.generate_image, { prompt: "a red panda", size: "512x512" });

    expect(stub.requestBody()).toMatchObject({ size: "512x512" });
  });

  it("rejects when the session has no image model selected", async () => {
    expect(run(tools.generate_image, { prompt: "a red panda" })).rejects.toThrow(
      /No image model is selected/,
    );
  });

  it("gives the model the compact metadata, never the image payload", () => {
    const toModelOutput = tools.generate_image?.toModelOutput as (args: {
      output: unknown;
    }) => unknown;

    expect(
      toModelOutput({
        output: { model: "local:flux", mediaType: "image/png", image: "data:…" },
      }),
    ).toEqual({ type: "json", value: { model: "local:flux", mediaType: "image/png" } });
  });
});
