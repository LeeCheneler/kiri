import { readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import type { ConfigStore } from "../config/store.ts";

/** Workspace-root file holding standing instructions for every session. */
export const INSTRUCTIONS_FILENAME = "kiri.md";

/** Directory instructions governing that directory and its descendants. */
export const AGENTS_FILENAME = "AGENTS.md";

/** One directory's instructions, with the scope they govern. */
export interface AgentsInstructions {
  directory: string;
  text: string;
}

/** Authorized sources used to resolve a session's standing instructions. */
export interface InstructionSources {
  config?: ConfigStore;
  project?: { name: string; instructions?: string | null } | null;
  workingDirectory?: string | null;
  allowedDirectories?: readonly string[];
}

/** Standing instructions kept separate by scope, with directories broadest first. */
export interface StandingInstructions {
  workspace: string | null;
  project: { name: string; text: string } | null;
  directories: AgentsInstructions[];
}

// Check both the named path and its real target before opening it: an
// instruction filename must not make a secret or internal file readable.
function isInstructionPath(path: string): boolean {
  return !path
    .split(sep)
    .some((part) => part === ".git" || part === ".kiri" || part.startsWith(".env"));
}

function isWithin(roots: readonly string[], path: string): boolean {
  return roots.some((root) => {
    const subpath = relative(root, path);
    return subpath !== ".." && !subpath.startsWith(`..${sep}`) && !isAbsolute(subpath);
  });
}

// Missing, empty, and unreadable instruction files are optional. Directory
// instructions additionally require containment before any bytes are read.
function readInstructions(path: string, roots?: readonly string[]): string | null {
  if (!isInstructionPath(path)) return null;
  try {
    const real = realpathSync(path);
    if (!isInstructionPath(real) || (roots !== undefined && !isWithin(roots, real))) return null;
    const text = readFileSync(real, "utf8").trim();
    return text === "" ? null : text;
  } catch {
    return null;
  }
}

/**
 * Read the directory's AGENTS.md chain broadest first, checking real paths
 * against the allowed roots before opening files. Resolve fresh on every call.
 */
export function readAgentsChain(
  workingDirectory: string | null,
  allowedDirectories: readonly string[],
): AgentsInstructions[] {
  if (workingDirectory === null || !isInstructionPath(workingDirectory)) return [];
  const roots = new Set<string>();
  for (const dir of allowedDirectories) {
    try {
      roots.add(realpathSync(dir));
    } catch {
      // A missing allowed directory cannot contain instructions.
    }
  }
  if (roots.size === 0) return [];
  const allowed = [...roots];
  let real: string;
  try {
    real = realpathSync(workingDirectory);
  } catch {
    return [];
  }
  if (!isInstructionPath(real) || !isWithin(allowed, real)) return [];
  const chain: AgentsInstructions[] = [];
  for (let dir = real; ; dir = dirname(dir)) {
    if (isWithin(allowed, dir)) {
      const text = readInstructions(join(dir, AGENTS_FILENAME), allowed);
      if (text !== null) chain.unshift({ directory: dir, text });
    }
    if (dirname(dir) === dir) break;
  }
  return chain;
}

/** Resolve workspace, project, and scoped directory instructions for any session. */
export function resolveStandingInstructions(sources: InstructionSources): StandingInstructions {
  const projectText = sources.project?.instructions?.trim() ?? "";
  return {
    workspace: sources.config ? readInstructions(sources.config.instructionsFile()) : null,
    project:
      sources.project && projectText !== ""
        ? { name: sources.project.name, text: projectText }
        : null,
    directories: readAgentsChain(
      sources.workingDirectory ?? null,
      sources.allowedDirectories ?? [],
    ),
  };
}
