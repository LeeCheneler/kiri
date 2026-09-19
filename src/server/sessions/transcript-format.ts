import type { UIMessage } from "ai";
import { z } from "zod";

/**
 * The format of rows written before parts were versioned: AI SDK v6
 * `UIMessage` parts alongside Kiri's own data parts.
 */
export const LEGACY_PARTS_FORMAT = 0;

/**
 * The format every write is stamped with. It names the shape of a stored
 * parts array and changes only when that shape does — unlike a session's
 * transcript revision, which counts changes to its content.
 */
export const CURRENT_PARTS_FORMAT = 1;

/** Thrown when a stored message's parts can't be read as the current format. */
export class TranscriptFormatError extends Error {
  constructor(messageId: string, reason: string) {
    super(`stored message "${messageId}" is unreadable: ${reason}`);
    this.name = "TranscriptFormatError";
  }
}

// SDK parts are checked for their discriminator alone: the SDK owns their
// shape, and a part type this build doesn't know — a removed tool, a newer
// SDK part — must stay readable.
const part = z.looseObject({ type: z.string() });

const message = z.looseObject({
  id: z.string(),
  role: z.enum(["user", "assistant", "system"]),
  parts: z.array(part),
});

// Kiri's own parts are its durable contract, and their readers dereference
// them unguarded. A calibration carries its own payload version, which its
// reader checks, so only its envelope is fixed here.
const kiriParts: Record<string, z.ZodType> = {
  "data-inbox": z.looseObject({
    id: z.string(),
    data: z.looseObject({
      source: z.enum(["user", "parent", "child"]),
      text: z.string(),
      fromSessionId: z.string().optional(),
      queuedAt: z.number(),
    }),
  }),
  "data-checkpoint": z.looseObject({
    id: z.string(),
    data: z.looseObject({
      summary: z.string(),
      pendingMessages: z.array(message).optional(),
    }),
  }),
  "data-instructions": z.looseObject({
    data: z.looseObject({
      workspace: z.string(),
      project: z.string(),
      directories: z.array(z.looseObject({ directory: z.string(), digest: z.string() })),
      targets: z.array(
        z.looseObject({
          directory: z.string(),
          scope: z.enum(["filesystem", "workflow"]),
          recursive: z.boolean(),
        }),
      ),
    }),
  }),
  "data-context-calibration": z.looseObject({ data: z.looseObject({ version: z.number() }) }),
};

// Validation never rewrites: a row that passes is returned as it was stored.
function validate(messageId: string, raw: unknown): UIMessage["parts"] {
  const parts = z.array(part).safeParse(raw);
  if (!parts.success) {
    throw new TranscriptFormatError(messageId, "its parts are not a list of typed parts");
  }
  for (const stored of parts.data) {
    if (kiriParts[stored.type]?.safeParse(stored).success === false) {
      throw new TranscriptFormatError(messageId, `its "${stored.type}" part is malformed`);
    }
  }
  return raw as UIMessage["parts"];
}

/**
 * Read a stored message's parts as the current format: validate what the
 * column held, then adapt it from the format its row was written in. Messages
 * nested in a checkpoint share their row's format, so an adapter owns them
 * too. Throws `TranscriptFormatError` for malformed parts and for a format
 * newer than this build writes.
 */
export function readStoredParts(
  messageId: string,
  format: number,
  raw: unknown,
): UIMessage["parts"] {
  switch (format) {
    // The legacy format is the current one under another name, so it adapts
    // by passing through.
    case LEGACY_PARTS_FORMAT:
    case CURRENT_PARTS_FORMAT:
      return validate(messageId, raw);
    default:
      throw new TranscriptFormatError(
        messageId,
        `it was written in parts format ${format}, newer than this version of kiri reads`,
      );
  }
}
