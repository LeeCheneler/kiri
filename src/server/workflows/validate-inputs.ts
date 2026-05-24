import type { z } from "zod";
import { buildInputSchema } from "./build-input-schema.ts";
import type { WorkflowDefinition } from "./schema.ts";

export type ValidateInputsResult = { ok: true } | { ok: false; error: string };

/**
 * Validate a `Record<string, string>` invoke payload against a workflow's
 * declared inputs. Thin wrapper over `buildInputSchema(def).safeParse(...)`
 * that picks the highest-priority issue and returns its message as the
 * `error` string, preserving the legacy single-string contract.
 *
 * Precedence (unknown key → missing required → out-of-options) is enforced
 * in `formatError` so the message a caller sees stays stable as the schema
 * grows.
 */
export const validateInputs = (
  def: WorkflowDefinition,
  supplied: Record<string, string>,
): ValidateInputsResult => {
  const result = buildInputSchema(def).safeParse(supplied);
  if (result.success) return { ok: true };
  return { ok: false, error: formatError(def, result.error) };
};

// Lower number = higher priority. `unrecognized_keys` from `.strict()`
// wins over field-level invalid_type/too_small ("is required"), which
// wins over custom checks (options).
const priority = (code: string): number => {
  if (code === "unrecognized_keys") return 0;
  if (code === "custom") return 2;
  return 1;
};

const formatError = (def: WorkflowDefinition, err: z.ZodError): string => {
  const sorted = [...err.issues].sort((a, b) => priority(a.code) - priority(b.code));
  const issue = sorted[0];
  if (!issue) return "invalid inputs";
  if (issue.code === "unrecognized_keys") {
    const keys = (issue as { keys?: readonly string[] }).keys ?? [];
    if (!def.inputs) {
      return `workflow "${def.name}" declares no inputs; received: ${keys.join(", ")}`;
    }
    return `unknown input "${keys[0]}"`;
  }
  return issue.message;
};
