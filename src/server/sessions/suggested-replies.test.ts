import { describe, expect, it } from "bun:test";
import type { LlmClients } from "../llm/index.ts";
import { generateSuggestedReplies } from "./suggested-replies.ts";

const fakeClients = (
  respond: (options: { model: string; prompt: string; abortSignal?: AbortSignal }) => string,
): Pick<LlmClients, "generateText"> => ({
  generateText: async (options) => ({ text: respond(options), usage: {} }),
});

const generate = (text: string, assistantText = "Shall I go ahead?") =>
  generateSuggestedReplies({
    llmClients: fakeClients(() => text),
    model: "openai:gpt-mini",
    assistantText,
  });

describe("generateSuggestedReplies", () => {
  it("returns the replies after a confirmation ending", async () => {
    const replies = await generate("ENDING: confirmation\nYes, proceed\nNo, hold off");
    expect(replies).toEqual(["Yes, proceed", "No, hold off"]);
  });

  it("returns the replies after a choice ending", async () => {
    const replies = await generate("ENDING: choice\nOption A\nOption B");
    expect(replies).toEqual(["Option A", "Option B"]);
  });

  it("returns no replies on an abstaining ending, ignoring stray lines after it", async () => {
    const replies = await generate("ENDING: none\nYes, proceed");
    expect(replies).toEqual([]);
  });

  it("returns no replies when no ENDING line is present", async () => {
    const replies = await generate("Here are some ideas:\nYes, proceed\nNo, hold off");
    expect(replies).toEqual([]);
  });

  it("returns no replies on an unknown ending value", async () => {
    const replies = await generate("ENDING: maybe\nYes, proceed");
    expect(replies).toEqual([]);
  });

  it("parses the ENDING line case- and whitespace-tolerantly, skipping preamble", async () => {
    const replies = await generate("Sure, here you go.\n  Ending:  CONFIRMATION\nYes, proceed");
    expect(replies).toEqual(["Yes, proceed"]);
  });

  it("strips list markers and surrounding quotes from reply lines", async () => {
    const replies = await generate("ENDING: choice\n- \"Option A\"\n* 'Option B'\n1. Option C");
    expect(replies).toEqual(["Option A", "Option B", "Option C"]);
  });

  it("drops blank, sentinel, header, and over-long lines", async () => {
    const replies = await generate(
      `ENDING: confirmation\n\nNONE\nSuggested replies:\n${"x".repeat(80)}\nYes, proceed`,
    );
    expect(replies).toEqual(["Yes, proceed"]);
  });

  it("drops a stray ENDING echo among the reply lines", async () => {
    const replies = await generate("ENDING: confirmation\nENDING: confirmation\nYes, proceed");
    expect(replies).toEqual(["Yes, proceed"]);
  });

  it("dedupes replies case-insensitively", async () => {
    const replies = await generate("ENDING: confirmation\nYes, proceed\nYES, PROCEED\nNo");
    expect(replies).toEqual(["Yes, proceed", "No"]);
  });

  it("caps the replies at three", async () => {
    const replies = await generate("ENDING: choice\nOne\nTwo\nThree\nFour");
    expect(replies).toEqual(["One", "Two", "Three"]);
  });

  it("returns no replies when the model call rejects", async () => {
    const clients: Pick<LlmClients, "generateText"> = {
      generateText: async () => {
        throw new Error("provider down");
      },
    };
    const replies = await generateSuggestedReplies({
      llmClients: clients,
      model: "openai:gpt-mini",
      assistantText: "Shall I go ahead?",
    });
    expect(replies).toEqual([]);
  });

  it("returns no replies when the generation exceeds its timeout", async () => {
    const clients: Pick<LlmClients, "generateText"> = {
      generateText: ({ abortSignal }) =>
        new Promise((_resolve, reject) => {
          abortSignal?.addEventListener("abort", () => reject(abortSignal.reason));
        }),
    };
    const replies = await generateSuggestedReplies({
      llmClients: clients,
      model: "openai:gpt-mini",
      assistantText: "Shall I go ahead?",
      timeoutMs: 5,
    });
    expect(replies).toEqual([]);
  });

  it("returns no replies without calling the model for blank assistant text", async () => {
    let called = false;
    const clients = fakeClients(() => {
      called = true;
      return "ENDING: confirmation\nYes";
    });
    const replies = await generateSuggestedReplies({
      llmClients: clients,
      model: "openai:gpt-mini",
      assistantText: "   \n  ",
    });
    expect(replies).toEqual([]);
    expect(called).toBe(false);
  });

  it("sends the tail of a long assistant message, not its head", async () => {
    let prompt = "";
    const clients = fakeClients((options) => {
      prompt = options.prompt;
      return "ENDING: none";
    });
    const assistantText = `HEAD-MARKER ${"x".repeat(3000)} Shall I go ahead?`;
    await generateSuggestedReplies({
      llmClients: clients,
      model: "openai:gpt-mini",
      assistantText,
    });
    expect(prompt).toContain("Shall I go ahead?");
    expect(prompt).not.toContain("HEAD-MARKER");
  });
});
