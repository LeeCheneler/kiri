/**
 * Strip the app-only image payload from a generate_image result, leaving the
 * compact metadata the model acts on. The data URL exists for the transcript's
 * rendering; to the model it is pure token re-payment — base64 describing
 * pixels it has no use for.
 */
export function compactImageOutput(output: unknown): unknown {
  if (typeof output !== "object" || output === null || !("image" in output)) return output;
  const { image: _image, ...rest } = output as Record<string, unknown>;
  return rest;
}
