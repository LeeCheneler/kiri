const encoder = new TextEncoder();
const TRUNCATION_MARKER = "\n[truncated — result too large]";
const OMISSION_NOTICE = {
  type: "text",
  text: "[omitted — some content was invalid or exceeded text, media, or result limits]",
};

/** Independent byte budgets for data, decoded images, and the complete encoded result. */
export interface McpResultBounds {
  maxBytes: number;
  maxImageBytes: number;
  maxResultBytes: number;
}

function jsonBytes(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function imageFits(part: Record<string, unknown>, maxImageBytes: number): boolean {
  const { data, mimeType } = part;
  if (typeof data !== "string" || typeof mimeType !== "string" || !mimeType.startsWith("image/")) {
    return false;
  }
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  const decodedBytes = (data.length / 4) * 3 - padding;
  // Measure without allocating a decoded copy; reject oversize before scanning base64.
  return (
    decodedBytes <= maxImageBytes && data.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(data)
  );
}

function truncatedText(text: string, maxBytes: number): { type: "text"; text: string } | null {
  const part = { type: "text" as const, text: TRUNCATION_MARKER };
  if (jsonBytes(part) > maxBytes) return null;
  let low = 0;
  let high = text.length;
  // JSON escaping, not just UTF-8 text length, determines how much fits.
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    part.text = text.slice(0, middle) + TRUNCATION_MARKER;
    if (jsonBytes(part) <= maxBytes) low = middle;
    else high = middle - 1;
  }
  let head = text.slice(0, low);
  if (/[\uD800-\uDBFF]$/.test(head)) head = head.slice(0, -1);
  return { type: "text", text: head + TRUNCATION_MARKER };
}

/** Bound any MCP output, preserving typed images and unique content while making omissions explicit. */
export function boundMcpResult(output: unknown, bounds: McpResultBounds): unknown {
  const { maxBytes, maxImageBytes, maxResultBytes } = bounds;
  if (!Number.isInteger(maxResultBytes) || maxResultBytes < 256) {
    throw new RangeError("MCP encoded result budget must be an integer of at least 256 bytes");
  }
  if (
    !Number.isInteger(maxBytes) ||
    maxBytes < 0 ||
    !Number.isInteger(maxImageBytes) ||
    maxImageBytes < 0
  ) {
    throw new RangeError("MCP text and image budgets must be non-negative integers");
  }
  if (!isRecord(output) || !Array.isArray(output.content)) {
    if (jsonBytes(output) <= Math.min(maxBytes, maxResultBytes)) return output;
    const text = typeof output === "string" ? output : JSON.stringify(output);
    const part = truncatedText(text, Math.min(maxBytes, maxResultBytes - 16));
    return { content: [part ?? OMISSION_NOTICE] };
  }

  const { content, structuredContent, ...metadata } = output;
  let envelope: Record<string, unknown> = { ...metadata, content: [] };
  let textBytes = jsonBytes(metadata) - 2;
  let omitted = false;
  if (textBytes > maxBytes) {
    envelope = {
      ...(typeof metadata.isError === "boolean" ? { isError: metadata.isError } : {}),
      content: [],
    };
    textBytes = 0;
    omitted = true;
  }
  const structuredJson = structuredContent == null ? undefined : JSON.stringify(structuredContent);
  if (structuredJson !== undefined) {
    const size = encoder.encode(structuredJson).length;
    if (size <= maxBytes - textBytes) {
      envelope.structuredContent = structuredContent;
      textBytes += size;
    } else omitted = true;
  }

  let resultBytes = jsonBytes(envelope);
  if (resultBytes > maxResultBytes) {
    // Server metadata is also bounded; keep the error status even when its other fields cannot fit.
    envelope = {
      ...(typeof metadata.isError === "boolean" ? { isError: metadata.isError } : {}),
      content: [],
    };
    textBytes = 0;
    omitted = true;
    resultBytes = jsonBytes(envelope);
  }

  const parts: unknown[] = [];
  const sizes: number[] = [];
  const add = (part: unknown, size: number): boolean => {
    const cost = size + (parts.length > 0 ? 1 : 0);
    if (resultBytes + cost > maxResultBytes) return false;
    parts.push(part);
    sizes.push(cost);
    resultBytes += cost;
    return true;
  };

  for (const part of content) {
    if (
      envelope.structuredContent !== undefined &&
      isRecord(part) &&
      part.type === "text" &&
      part.text === structuredJson
    ) {
      continue;
    }
    if (isRecord(part) && part.type === "image") {
      if (!imageFits(part, maxImageBytes) || !add(part, jsonBytes(part))) omitted = true;
      continue;
    }
    const size = jsonBytes(part);
    const remaining = Math.min(
      maxBytes - textBytes,
      maxResultBytes - resultBytes - (parts.length > 0 ? 1 : 0),
    );
    if (size <= remaining) {
      add(part, size);
      textBytes += size;
    } else {
      const text =
        isRecord(part) && part.type === "text" && typeof part.text === "string"
          ? part.text
          : JSON.stringify(part);
      const truncated = truncatedText(text, remaining);
      if (truncated !== null) {
        const size = jsonBytes(truncated);
        add(truncated, size);
        textBytes += size;
      } else omitted = true;
    }
  }

  if (omitted) {
    const noticeBytes = jsonBytes(OMISSION_NOTICE);
    // Keep a single bounded notice, rather than one per omitted item in an arbitrary-size array.
    while (
      resultBytes + noticeBytes + (parts.length > 0 ? 1 : 0) > maxResultBytes &&
      parts.length > 0
    ) {
      parts.pop();
      resultBytes -= sizes.pop() as number;
    }
    if (!add(OMISSION_NOTICE, noticeBytes)) {
      envelope = {
        ...(typeof metadata.isError === "boolean" ? { isError: metadata.isError } : {}),
        content: [],
      };
      return { ...envelope, content: [OMISSION_NOTICE] };
    }
  }
  return { ...envelope, content: parts };
}
