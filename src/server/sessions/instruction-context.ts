import { createHash } from "node:crypto";
import { existsSync, readdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import type { UIMessage } from "ai";
import {
  type AgentsInstructions,
  type InstructionSources,
  type StandingInstructions,
  readAgentsChain,
  resolveStandingInstructions,
} from "./instructions.ts";

interface InstructionTarget {
  directory: string;
  scope: "filesystem" | "workflow";
  recursive: boolean;
}

interface InstructionReceipt {
  workspace: string;
  project: string;
  directories: Array<{ directory: string; digest: string }>;
  targets: InstructionTarget[];
}

/** Tracks rules delivered to a model step, including across approval continuations. */
export interface InstructionContext {
  resolve: (sources: InstructionSources) => StandingInstructions;
  requireForDirectory: (
    directory: string,
    options?: { scope?: "filesystem" | "workflow"; recursive?: boolean },
  ) => void;
  receipt: () => InstructionReceipt | null;
  restore: (parts: UIMessage["parts"]) => void;
}

const digest = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

const contains = (directory: string, target: string): boolean => {
  const path = relative(directory, target);
  return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
};

// A new file can have missing parents; the closest existing parent still
// supplies all rules that govern creating them.
function existingDirectory(directory: string): string {
  let current = directory;
  while (!existsSync(current) && dirname(current) !== current) current = dirname(current);
  return realpathSync(current);
}

/**
 * Resolve scoped rules for prompts and reject mutations governed by rules the
 * model has not yet seen. Checks only queue scopes; prompt resolution records delivery.
 */
export function createInstructionContext(getSources: () => InstructionSources): InstructionContext {
  let seen: InstructionReceipt | null = null;
  let targets: InstructionTarget[] = [];

  const targetRules = (target: InstructionTarget, sources: InstructionSources) => {
    const roots = (
      target.scope === "workflow"
        ? sources.config
          ? [sources.config.cwd()]
          : []
        : (sources.allowedDirectories ?? [])
    )
      .filter((root) => existsSync(root))
      .map((root) => realpathSync(root));
    const directories = [existingDirectory(target.directory)];
    if (
      !roots.some((root) => contains(root, directories[0])) ||
      directories[0]
        .split(sep)
        .some((part) => part === ".git" || part === ".kiri" || part.startsWith(".env"))
    )
      return { roots, rules: [] };
    if (target.recursive && existsSync(target.directory)) {
      for (const directory of directories) {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
          // Deleting a symlink does not mutate its target. Internal and secret
          // trees never become instruction sources, even during a recursive delete.
          if (
            entry.isDirectory() &&
            entry.name !== ".git" &&
            entry.name !== ".kiri" &&
            !entry.name.startsWith(".env")
          )
            directories.push(join(directory, entry.name));
        }
      }
    }
    const rules = new Map<string, AgentsInstructions>();
    for (const directory of directories) {
      for (const rule of readAgentsChain(directory, roots)) rules.set(rule.directory, rule);
    }
    return {
      roots,
      rules: [...rules.values()].sort((a, b) => a.directory.localeCompare(b.directory)),
    };
  };

  return {
    resolve(sources) {
      const instructions = resolveStandingInstructions(sources);
      const directories = new Map(instructions.directories.map((rule) => [rule.directory, rule]));
      for (const target of targets) {
        for (const rule of targetRules(target, sources).rules)
          directories.set(rule.directory, rule);
      }
      instructions.directories = [...directories.values()].sort((a, b) =>
        a.directory.localeCompare(b.directory),
      );
      seen = {
        workspace: digest(instructions.workspace),
        project: digest(instructions.project),
        directories: instructions.directories.map(({ directory, text }) => ({
          directory,
          digest: digest(text),
        })),
        targets: [...targets],
      };
      return instructions;
    },
    requireForDirectory(directory, options = {}) {
      const target: InstructionTarget = {
        directory,
        scope: options.scope ?? "filesystem",
        recursive: options.recursive ?? false,
      };
      const sources = getSources();
      const current = resolveStandingInstructions(sources);
      const { roots, rules } = targetRules(target, sources);
      if (!targets.some((item) => JSON.stringify(item) === JSON.stringify(target))) {
        targets.push(target);
      }
      const previous =
        seen?.directories.filter(
          (rule) =>
            roots.some((root) => contains(root, rule.directory)) &&
            (contains(rule.directory, directory) ||
              (target.recursive && contains(directory, rule.directory))),
        ) ?? [];
      if (
        digest(current.workspace) !== (seen?.workspace ?? digest(null)) ||
        digest(current.project) !== (seen?.project ?? digest(null)) ||
        JSON.stringify(
          rules.map(({ directory, text }) => ({ directory, digest: digest(text) })),
        ) !== JSON.stringify(previous)
      ) {
        throw new Error(
          `Standing instructions for "${directory}" have not been considered in this model step. Nothing was changed or started. Kiri will supply the current scoped instructions before the next model step; reconsider this action under those rules before retrying. Tool approval is still required where configured.`,
        );
      }
    },
    receipt: () => seen,
    restore(parts) {
      // Only the server's persisted assistant parts may be passed here. A
      // receipt stores hashes, never instruction text, and conveys no permission.
      const part = parts.findLast((part) => part.type === "data-instructions");
      seen = part ? (part as { data: InstructionReceipt }).data : null;
      targets = seen ? [...seen.targets] : [];
    },
  };
}
