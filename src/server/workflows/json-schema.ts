import { z } from "zod";
import { workflowSchema } from "./schema.ts";

/**
 * Generate the JSON Schema (Draft 2020-12) representation of the workflow
 * definition shape. Used to produce `.kiri/workflow.schema.json` for IDE/LSP
 * integration so editors can validate and autocomplete YAML workflow files.
 */
export function workflowJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(workflowSchema) as Record<string, unknown>;
}
