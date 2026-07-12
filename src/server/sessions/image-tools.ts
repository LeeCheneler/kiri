import { type JSONValue, type ToolSet, generateImage, tool } from "ai";
import { z } from "zod";
import type { KiriDb } from "../db/index.ts";
import type { LlmClients } from "../llm/index.ts";
import { compactImageOutput } from "./image-tool-results.ts";
import { getSession } from "./store.ts";

/** Dependencies for the first-party image tools. */
export interface ImageToolsDeps {
  db: KiriDb;
  /** The session whose selected image model generations run against. */
  sessionId: string;
  llmClients: LlmClients;
}

/**
 * First-party image tools for a session: `generate_image` renders a text
 * prompt with the session's selected image model. The session routes offer
 * the set only while an image model is selected, and the selection is re-read
 * on every call, so a mid-turn change applies immediately. The result carries
 * the image as a data URL for the transcript to render; the model only ever
 * sees the compact metadata (see image-tool-results.ts).
 */
export function imageTools(deps: ImageToolsDeps): ToolSet {
  const { db, sessionId, llmClients } = deps;
  return {
    generate_image: tool({
      description:
        "Generate an image from a text prompt with the session's selected image model. The generated image is shown to the user directly in the conversation — do not repeat or link it. One image per call.",
      inputSchema: z.object({
        prompt: z.string().min(1).describe("What to generate, as a plain-text description."),
        size: z
          .string()
          .regex(/^\d+x\d+$/)
          .optional()
          .describe(
            'Image dimensions as "{width}x{height}", e.g. "1024x1024". Omit for the model default — not every model supports it.',
          ),
      }),
      execute: async ({ prompt, size }) => {
        const imageModelId = getSession(db, sessionId)?.imageModel;
        if (!imageModelId) {
          throw new Error(
            "No image model is selected for this session — the user can pick one in the session's Image model control.",
          );
        }
        const { image } = await generateImage({
          model: llmClients.resolveImageModel(imageModelId),
          prompt,
          size: size as `${number}x${number}` | undefined,
        });
        return {
          model: imageModelId,
          mediaType: image.mediaType,
          image: `data:${image.mediaType};base64,${image.base64}`,
        };
      },
      toModelOutput: ({ output }) => ({
        type: "json" as const,
        value: compactImageOutput(output) as JSONValue,
      }),
    }),
  };
}
