import { z } from "zod";

/**
 * A `{ env: <NAME> }` reference to an environment variable holding a secret
 * value (an API key, token, etc.). The only form secrets may take in the
 * git-tracked `kiri.yaml` — a literal value is rejected so secrets stay out of
 * version control. Only the variable's *name* is kept; its value is read at use
 * time, never persisted.
 */
export const envRefSchema = z
  .object({
    env: z.string().min(1).describe("Name of an environment variable holding the secret value."),
  })
  .strict()
  .describe(
    "Reference to an environment variable holding a secret value. Only this `{ env: <NAME> }` form is allowed — a literal value is rejected so secrets stay out of git-tracked YAML.",
  );

/** A structured `{ env: <NAME> }` reference to an environment variable. */
export type EnvRef = z.infer<typeof envRefSchema>;
