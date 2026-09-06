import { NoTranscriptGeneratedError, experimental_transcribe as transcribe } from "ai";
import type { LlmClients } from "../llm/index.ts";
import { tidyDraft } from "./tidy-draft.ts";

// A user is holding the composer open waiting on this, but a long dictated
// recording on a routed provider takes a while to come back in full.
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Turn a push-to-talk recording into composer draft text: transcribe the
 * audio with the configured transcription model, then — when a utility
 * model is configured — tidy the transcript into the message its speaker
 * meant, the same rewrite the composer's tidy action runs. The audio's
 * media type is sniffed from its bytes by the SDK, so the browser's
 * recording container (webm, mp4, ogg) needs no declaring. Silence, which
 * the model reports as no transcript at all, resolves to an empty string;
 * a provider error or timeout throws — this is a user-triggered action, so
 * a failure is theirs to see.
 */
export async function transcribeDraft(opts: {
  llmClients: Pick<LlmClients, "resolveTranscriptionModel" | "generateText">;
  /** The `provider:model` reference of the transcription model. */
  transcriptionModel: string;
  /** The `provider:model` reference of the utility model that tidies the transcript, if any. */
  utilityModel?: string;
  /** The recording's bytes. */
  audio: Uint8Array;
  timeoutMs?: number;
}): Promise<string> {
  const {
    llmClients,
    transcriptionModel,
    utilityModel,
    audio,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = opts;
  let spoken: string;
  try {
    const { text } = await transcribe({
      model: llmClients.resolveTranscriptionModel(transcriptionModel),
      audio,
      abortSignal: AbortSignal.timeout(timeoutMs),
    });
    spoken = text.trim();
  } catch (cause) {
    if (NoTranscriptGeneratedError.isInstance(cause)) return "";
    throw cause;
  }
  if (spoken === "" || utilityModel === undefined) return spoken;
  return tidyDraft({ llmClients, model: utilityModel, text: spoken });
}
