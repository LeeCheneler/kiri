import { NoTranscriptGeneratedError, experimental_transcribe as transcribe } from "ai";
import type { LlmClients } from "../llm/index.ts";

// A user is holding the composer open waiting on this, but a long dictated
// recording on a routed provider takes a while to come back in full.
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Turn a push-to-talk recording into trimmed composer draft text. The audio's
 * media type is sniffed from its bytes by the SDK, so the browser's recording
 * container (webm, mp4, ogg) needs no declaring. Silence, which the model
 * reports as no transcript at all, resolves to an empty string; a provider
 * error or timeout throws — this is a user-triggered action, so a failure is
 * theirs to see.
 */
export async function transcribeDraft(opts: {
  llmClients: Pick<LlmClients, "resolveTranscriptionModel">;
  /** The `provider:model` reference of the transcription model. */
  transcriptionModel: string;
  /** The recording's bytes. */
  audio: Uint8Array;
  timeoutMs?: number;
}): Promise<string> {
  const { llmClients, transcriptionModel, audio, timeoutMs = DEFAULT_TIMEOUT_MS } = opts;
  try {
    const { text } = await transcribe({
      model: llmClients.resolveTranscriptionModel(transcriptionModel),
      audio,
      abortSignal: AbortSignal.timeout(timeoutMs),
    });
    return text.trim();
  } catch (cause) {
    if (NoTranscriptGeneratedError.isInstance(cause)) return "";
    throw cause;
  }
}
