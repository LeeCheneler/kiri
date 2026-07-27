import { z } from "zod";

const prepareSchema = z
  .object({
    env: z
      .enum(["symlink", "copy"])
      .optional()
      .describe(
        'How to seed a new worktree with the source checkout\'s gitignored .env files: "symlink" shares them with the source, "copy" gives the worktree its own copies. Omitted leaves env files untouched.',
      ),
    install: z
      .enum(["auto", "off"])
      .optional()
      .describe(
        'Dependency install after creating a worktree: "auto" detects lockfiles and installs, "off" skips it. Defaults to "auto".',
      ),
    postCreate: z
      .array(z.string().min(1))
      .optional()
      .describe(
        "Commands run in the new worktree after create and install, in order. Defaults to none.",
      ),
  })
  .strict();

const overridesSchema = z
  .object({
    prepare: prepareSchema.optional(),
  })
  .strict();

/**
 * Schema for the `worktrees:` section in `kiri.yaml`: the folders to scan for
 * git repos and worktrees, plus the prepare policy — as `defaults:` and per-repo
 * `repos:` overrides deep-merged over them.
 */
export const worktreesSchema = z
  .object({
    roots: z
      .array(z.string().min(1))
      .describe(
        "Folders to scan for git repos and their worktrees, one level deep: a root that is itself a git repo is included, otherwise its immediate children are scanned (no recursion). Absolute paths are allowed, a leading ~ expands to your home directory, and a relative path resolves against the workspace root.",
      ),
    defaults: overridesSchema
      .optional()
      .describe("Baseline prepare settings applied to every repo."),
    repos: z
      .record(z.string().min(1), overridesSchema)
      .optional()
      .describe(
        "Per-repo overrides keyed by the repo's directory name, deep-merged field-by-field over `defaults`.",
      ),
  })
  .strict()
  .describe(
    "Worktree management: the folders to scan for repos and the prepare policy applied when creating their worktrees.",
  );

/** The raw, validated `worktrees:` section. */
export type WorktreesConfig = z.infer<typeof worktreesSchema>;

/** A single validated `prepare:` block — `defaults.prepare` or a repo override. */
export type WorktreePrepareConfig = z.infer<typeof prepareSchema>;
