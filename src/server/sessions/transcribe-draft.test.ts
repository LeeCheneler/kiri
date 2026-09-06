import { describe, expect, it } from "bun:test";
import { MockTranscriptionModelV3 } from "ai/test";
import type { LlmClients, LlmTranscriptionModel } from "../llm/index.ts";
import { TIDY_DRAFT_PROMPT_PREFIX } from "./tidy-draft.ts";
import { transcribeDraft } from "./transcribe-draft.ts";

// A bare RIFF/WAVE header, so the SDK sniffs real audio bytes.
const TINY_WAV = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
]);

type Clients = Pick<LlmClients, "resolveTranscriptionModel" | "generateText">;

// Clients whose transcription model answers with `transcript` (recording
// what it was asked) and whose utility generation answers with `tidied`.
const fakeClients = (opts: { transcript?: string | (() => never); tidied?: string } = {}) => {
  const transcribeCalls: { modelId: string; mediaType: string; audio: Uint8Array | string }[] = [];
  const generateCalls: { model: string; prompt: string }[] = [];
  const clients: Clients = {
    resolveTranscriptionModel: (id) =>
      new MockTranscriptionModelV3({
        modelId: id,
        doGenerate: async ({ audio, mediaType }) => {
          transcribeCalls.push({ modelId: id, mediaType, audio });
          const transcript = opts.transcript ?? "so um use postgres";
          return {
            text: typeof transcript === "function" ? transcript() : transcript,
            segments: [],
            language: undefined,
            durationInSeconds: undefined,
            warnings: [],
            response: { timestamp: new Date(), modelId: id },
          };
        },
      }) as LlmTranscriptionModel,
    generateText: async ({ model, prompt }) => {
      generateCalls.push({ model, prompt });
      return { text: opts.tidied ?? "Use Postgres.", usage: {} };
    },
  };
  return { clients, transcribeCalls, generateCalls };
};

describe("transcribeDraft", () => {
  it("transcribes the audio with the transcription model, then tidies with the utility model", async () => {
    const { clients, transcribeCalls, generateCalls } = fakeClients();

    const text = await transcribeDraft({
      llmClients: clients,
      transcriptionModel: "openrouter:openai/whisper-1",
      utilityModel: "local:tiny",
      audio: TINY_WAV,
    });

    expect(text).toBe("Use Postgres.");
    expect(transcribeCalls).toHaveLength(1);
    expect(transcribeCalls[0]?.modelId).toBe("openrouter:openai/whisper-1");
    expect(transcribeCalls[0]?.mediaType).toBe("audio/wav");
    expect(transcribeCalls[0]?.audio).toEqual(TINY_WAV);
    expect(generateCalls).toHaveLength(1);
    expect(generateCalls[0]?.model).toBe("local:tiny");
    expect(generateCalls[0]?.prompt.startsWith(TIDY_DRAFT_PROMPT_PREFIX)).toBe(true);
    expect(generateCalls[0]?.prompt).toContain("Draft message:\nso um use postgres");
  });

  it("returns the trimmed transcript untouched without a utility model", async () => {
    const { clients, generateCalls } = fakeClients({ transcript: "  so um use postgres \n" });

    const text = await transcribeDraft({
      llmClients: clients,
      transcriptionModel: "openai:whisper-1",
      audio: TINY_WAV,
    });

    expect(text).toBe("so um use postgres");
    expect(generateCalls).toHaveLength(0);
  });

  it("resolves to an empty string for silence, without tidying", async () => {
    const { clients, generateCalls } = fakeClients({ transcript: "" });

    const text = await transcribeDraft({
      llmClients: clients,
      transcriptionModel: "openai:whisper-1",
      utilityModel: "local:tiny",
      audio: TINY_WAV,
    });

    expect(text).toBe("");
    expect(generateCalls).toHaveLength(0);
  });

  it("skips tidying a transcript that is only whitespace", async () => {
    const { clients, generateCalls } = fakeClients({ transcript: " \n " });

    const text = await transcribeDraft({
      llmClients: clients,
      transcriptionModel: "openai:whisper-1",
      utilityModel: "local:tiny",
      audio: TINY_WAV,
    });

    expect(text).toBe("");
    expect(generateCalls).toHaveLength(0);
  });

  it("throws when the transcription model rejects", async () => {
    const { clients } = fakeClients({
      transcript: () => {
        throw new Error("provider down");
      },
    });

    await expect(
      transcribeDraft({
        llmClients: clients,
        transcriptionModel: "openai:whisper-1",
        audio: TINY_WAV,
      }),
    ).rejects.toThrow("provider down");
  });
});
