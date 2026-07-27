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

const cleanupSchema = z
  .object({
    mergedPr: z
      .enum(["off", "suggest", "auto"])
      .optional()
      .describe(
        'What to do once a worktree\'s pull request has merged: "off" ignores it, "suggest" flags it for one-click removal, "auto" removes it. Defaults to "suggest".',
      ),
    fetchIntervalMinutes: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        "How often, in minutes, to fetch remote state so merged pull requests are detected. Absent or 0 means manual refresh only.",
      ),
  })
  .strict();

const overridesSchema = z
  .object({
    prepare: prepareSchema.optional(),
    cleanup: cleanupSchema.optional(),
  })
  .strict();

/**
 * Schema for the `worktrees:` section in `kiri.yaml`: the folders to scan for
 * git repos and worktrees, plus the prepare/cleanup policy — as `defaults:` and
 * per-repo `repos:` overrides deep-merged over them.
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
      .describe("Baseline prepare and cleanup settings applied to every repo."),
    repos: z
      .record(z.string().min(1), overridesSchema)
      .optional()
      .describe(
        "Per-repo overrides keyed by the repo's directory name, deep-merged field-by-field over `defaults`.",
      ),
  })
  .strict()
  .describe(
    "Worktree management: the folders to scan for repos and the prepare/cleanup policy for creating and tidying their worktrees.",
  );

/** The raw, validated `worktrees:` section. */
export type WorktreesConfig = z.infer<typeof worktreesSchema>;

/** A single validated `prepare:` block — `defaults.prepare` or a repo override. */
export type WorktreePrepareConfig = z.infer<typeof prepareSchema>;

/** A single validated `cleanup:` block — `defaults.cleanup` or a repo override. */
export type WorktreeCleanupConfig = z.infer<typeof cleanupSchema>;
