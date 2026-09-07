import { describe, expect, it } from "bun:test";
import { MockTranscriptionModelV3 } from "ai/test";
import type { LlmClients, LlmTranscriptionModel } from "../llm/index.ts";
import { transcribeDraft } from "./transcribe-draft.ts";

// A bare RIFF/WAVE header, so the SDK sniffs real audio bytes.
const TINY_WAV = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
]);

type Clients = Pick<LlmClients, "resolveTranscriptionModel">;

// A client whose transcription model answers with `transcript`, recording what
// it was asked so the model, media type, and bytes remain covered.
const fakeClients = (transcript: string | (() => never) = "so um use postgres") => {
  const calls: { modelId: string; mediaType: string; audio: Uint8Array | string }[] = [];
  const clients: Clients = {
    resolveTranscriptionModel: (id) =>
      new MockTranscriptionModelV3({
        modelId: id,
        doGenerate: async ({ audio, mediaType }) => {
          calls.push({ modelId: id, mediaType, audio });
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
  };
  return { clients, calls };
};

describe("transcribeDraft", () => {
  it("returns the trimmed transcription without rewriting it", async () => {
    const { clients, calls } = fakeClients("  so um use postgres \n");

    const text = await transcribeDraft({
      llmClients: clients,
      transcriptionModel: "openrouter:openai/whisper-1",
      audio: TINY_WAV,
    });

    expect(text).toBe("so um use postgres");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.modelId).toBe("openrouter:openai/whisper-1");
    expect(calls[0]?.mediaType).toBe("audio/wav");
    expect(calls[0]?.audio).toEqual(TINY_WAV);
  });

  it("returns an empty string for an empty or whitespace-only transcript", async () => {
    for (const transcript of ["", " \n "]) {
      const { clients } = fakeClients(transcript);
      expect(
        await transcribeDraft({
          llmClients: clients,
          transcriptionModel: "openai:whisper-1",
          audio: TINY_WAV,
        }),
      ).toBe("");
    }
  });

  it("throws when the transcription model rejects", async () => {
    const { clients } = fakeClients(() => {
      throw new Error("provider down");
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
