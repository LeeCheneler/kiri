import { describe, expect, it } from "bun:test";
import type { LlmClients } from "../llm/index.ts";
import { TIDY_DRAFT_PROMPT_PREFIX, tidyDraft } from "./tidy-draft.ts";

const fakeClients = (
  respond: (options: { model: string; prompt: string; abortSignal?: AbortSignal }) => string,
): Pick<LlmClients, "generateText"> => ({
  generateText: async (options) => ({ text: respond(options), usage: {} }),
});

const tidy = (reply: string, text = "so um i think we should uh use postgres") =>
  tidyDraft({ llmClients: fakeClients(() => reply), model: "openai:gpt-mini", text });

describe("tidyDraft", () => {
  it("prompts the given model with the draft under the tidy instruction", async () => {
    const calls: { model: string; prompt: string; abortSignal?: AbortSignal }[] = [];
    await tidyDraft({
      llmClients: fakeClients((options) => {
        calls.push(options);
        return "Tidied.";
      }),
      model: "local:tiny",
      text: "the draft",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.model).toBe("local:tiny");
    expect(calls[0]?.prompt.startsWith(TIDY_DRAFT_PROMPT_PREFIX)).toBe(true);
    expect(calls[0]?.prompt).toContain("Draft message:\nthe draft");
    expect(calls[0]?.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it("returns the message after the MESSAGE line, dropping the decisions", async () => {
    expect(
      await tidy("DECISIONS:\n- database: Postgres (Redis abandoned)\nMESSAGE:\nUse Postgres.\n"),
    ).toBe("Use Postgres.");
  });

  it("keeps a multi-line message whole", async () => {
    expect(await tidy("DECISIONS:\n- two items\nMESSAGE:\nDo these:\n\n- one\n- two")).toBe(
      "Do these:\n\n- one\n- two",
    );
  });

  it("takes the whole reply, trimmed, when the model skipped the shape", async () => {
    expect(await tidy("\n  I think we should use Postgres.  \n")).toBe(
      "I think we should use Postgres.",
    );
  });

  it("unwraps a fence around the whole reply and around the message alone", async () => {
    expect(await tidy("```\nDECISIONS:\n- x\nMESSAGE:\nUse Postgres.\n```")).toBe("Use Postgres.");
    expect(await tidy("DECISIONS:\n- x\nMESSAGE:\n```markdown\nUse Postgres.\n```")).toBe(
      "Use Postgres.",
    );
  });

  it("leaves a fence that is only part of the reply alone", async () => {
    const reply = "Run this:\n\n```sh\nbun test\n```";
    expect(await tidy(reply)).toBe(reply);
  });

  it("returns the original draft when the model answers with nothing", async () => {
    expect(await tidy("  \n")).toBe("so um i think we should uh use postgres");
    expect(await tidy("```\n```")).toBe("so um i think we should uh use postgres");
    expect(await tidy("DECISIONS:\n- x\nMESSAGE:\n")).toBe(
      "so um i think we should uh use postgres",
    );
  });

  it("throws when the model call rejects", async () => {
    const clients: Pick<LlmClients, "generateText"> = {
      generateText: async () => {
        throw new Error("provider down");
      },
    };
    await expect(tidyDraft({ llmClients: clients, model: "m", text: "x" })).rejects.toThrow(
      "provider down",
    );
  });
});
