import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { z } from "zod";
import { publishNameSchema } from "../workflows/schema.ts";

// Shape of the invoke endpoint's optional JSON body. Values must be strings —
// inputs flow into env vars verbatim, and env vars are strings. The
// workflow-aware checks (unknown keys, required-and-missing, no-inputs-with-
// payload) live in `validateInputs` since they need the workflow definition.
export const invokeBodySchema = z
  .object({ inputs: z.record(z.string(), z.string()).optional() })
  .strict();

// Path-param schemas, shared across routes so the accepted shape for a
// run id or workflow name is declared once. `z.string().min(1)` matches
// the existing published-article validator — every legit id/name passes,
// and unknown values continue to 404 from their respective lookups.
export const runIdParamSchema = z.object({ id: z.string().min(1) });
export const workflowNameParamSchema = z.object({ name: z.string().min(1) });
export const publishedArticleParamSchema = z.object({
  id: z.string().min(1),
  name: publishNameSchema,
});

// Structural shape shared by `z.ZodError` (used by `safeParse`) and
// `$ZodError` (handed back by `@hono/zod-validator`'s callback). Both
// carry an `issues` array of `{ path, message }`; structurally typing
// the helper avoids picking one concrete class at the boundary.
export type ZodIssueLike = { path: ReadonlyArray<PropertyKey>; message: string };
export type ZodErrorLike = { issues: readonly ZodIssueLike[] };

/**
 * Build the 400 response body for a failed Zod parse: the existing
 * first-issue `error` summary plus a structured `issues` array carrying
 * each failure's field path. Modal callers can keep displaying `error`;
 * non-modal callers (CLI, debug tooling, future API clients) read
 * `issues` for the full diagnostic.
 */
export const zodErrorBody = (err: ZodErrorLike, fallback: string) => ({
  error: err.issues[0]?.message ?? fallback,
  issues: err.issues.map((issue) => ({
    // Zod's TS type allows symbol path segments; none of our schemas
    // produce them, but coerce defensively so the JSON is always plain.
    path: issue.path.map((seg) => (typeof seg === "symbol" ? seg.toString() : seg)),
    message: issue.message,
  })),
});

/**
 * Build the `@hono/zod-validator` failure hook that mirrors `zodErrorBody`'s
 * `{ error, issues }` response shape. Used at every `zValidator(...)` call site
 * (body, query, param) so validation 400s are uniform regardless of which
 * surface the failure came from.
 */
export const onZodFail =
  (fallback: string) =>
  (result: { success: true } | { success: false; error: ZodErrorLike }, c: Context) => {
    if (!result.success) {
      return c.json(zodErrorBody(result.error, fallback), 400);
    }
  };

declare module "hono" {
  interface ContextVariableMap {
    invokeBody: z.infer<typeof invokeBodySchema>;
  }
}

/**
 * Parse and validate an optional JSON request body against `invokeBodySchema`.
 * Empty body resolves to `{}`; malformed JSON returns 400; shape mismatch
 * returns 400 with the first Zod issue. On success the validated value is
 * exposed to the route handler via `c.get("invokeBody")`.
 */
export const optionalInvokeBody = createMiddleware(async (c, next) => {
  const raw = await c.req.text();
  let parsed: unknown = {};
  if (raw.length > 0) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
  }
  const result = invokeBodySchema.safeParse(parsed);
  if (!result.success) {
    return c.json(zodErrorBody(result.error, "invalid body"), 400);
  }
  c.set("invokeBody", result.data);
  return next();
});
