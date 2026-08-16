import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { ConfigStore } from "../config/store.ts";
import {
  type ArticleEntry,
  type WorkflowDefinition,
  type WorkflowStep,
  isUseArticle,
  isUseStep,
  workflowSchema,
} from "./schema.ts";

/**
 * A workflow file that failed to load — either a YAML parse error, a
 * schema-validation failure, a missing `use:` bundle, or a duplicate-name
 * conflict where another file already claimed the same workflow name.
 */
export interface WorkflowLoadFailure {
  /** Absolute path of the file that failed. */
  path: string;
  /** Human-readable reason. For duplicates, includes the conflicting name and the path that already claimed it. */
  reason: string;
}

export interface LoadResult {
  /** Workflow definitions keyed by `name`. */
  workflows: Map<string, WorkflowDefinition>;
  /** Maps each workflow's `name` to the file it was loaded from. */
  sources: Map<string, string>;
  /** Per-file failures. The first occurrence of a duplicate name wins; the loser is recorded here. */
  failures: WorkflowLoadFailure[];
}

const isYamlFile = (name: string): boolean => name.endsWith(".yaml") || name.endsWith(".yml");

const reasonOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const validateBundles = (def: WorkflowDefinition, config: ConfigStore): string[] => {
  const missing: string[] = [];
  const steps = def.summarize ? [...def.steps, def.summarize] : def.steps;
  for (const step of steps) {
    if (!isUseStep(step)) continue;
    if (!existsSync(config.bundleRunPath(step.use))) missing.push(step.use);
  }
  for (const entry of def.articles ?? []) {
    if (!isUseArticle(entry)) continue;
    if (!existsSync(config.bundleRunPath(entry.use))) missing.push(entry.use);
  }
  return missing;
};

// Same posture as missing bundles: an llm step naming a provider absent from
// the registry, or a prompt_file absent from disk, is a per-file load failure.
const validateLlmSteps = (
  def: WorkflowDefinition,
  config: ConfigStore,
  providerNames: ReadonlySet<string>,
): { unknownProviders: string[]; missingPromptFiles: string[] } => {
  const unknownProviders: string[] = [];
  const missingPromptFiles: string[] = [];
  const entries: (WorkflowStep | ArticleEntry)[] = [...def.steps, ...(def.articles ?? [])];
  if (def.summarize) entries.push(def.summarize);
  for (const entry of entries) {
    if (!("llm" in entry)) continue;
    // The schema guarantees `provider:model` form, so the prefix is non-empty.
    const provider = entry.llm.model.slice(0, entry.llm.model.indexOf(":"));
    if (!providerNames.has(provider)) unknownProviders.push(provider);
    if (
      entry.llm.prompt_file !== undefined &&
      !existsSync(resolve(config.cwd(), entry.llm.prompt_file))
    ) {
      missingPromptFiles.push(entry.llm.prompt_file);
    }
  }
  return { unknownProviders, missingPromptFiles };
};

// Same posture as a provider `api_key` ref in kiri.yaml: a `{ env: <NAME> }`
// ref naming a variable absent from the kiri process env is a per-file load
// failure — the run would only fail later, at spawn, with less context. Only
// the *name* is checked here; the value is read at spawn and never stored.
const unsetEnvRefs = (
  def: WorkflowDefinition,
  env: Record<string, string | undefined>,
): string[] => {
  const entries: (WorkflowStep | ArticleEntry)[] = [...def.steps, ...(def.articles ?? [])];
  if (def.summarize) entries.push(def.summarize);
  const unset = new Set<string>();
  for (const entry of entries) {
    for (const value of Object.values(entry.env ?? {})) {
      if (typeof value === "string" || !("env" in value)) continue;
      if (env[value.env] === undefined) unset.add(value.env);
    }
  }
  return Array.from(unset);
};

/**
 * Result of validating one workflow's raw YAML source: the parsed definition
 * when it is valid, or the human-readable reason it is not.
 */
export type ParseWorkflowSourceResult =
  | { ok: true; workflow: WorkflowDefinition }
  | { ok: false; reason: string };

/**
 * Validate one workflow's raw YAML source against everything the loader
 * checks per file: YAML parse, the workflow schema, `use:` bundle existence,
 * `llm:` provider registration against `providerNames`, prompt-file
 * existence, and `{ env: <NAME> }` refs naming a variable set in `env`. The
 * single validation gate for workflow sources — the directory loader runs
 * every file through it, and any other writer must too, so nothing invalid
 * is ever treated as loadable.
 */
export function parseWorkflowSource(
  raw: string,
  config: ConfigStore,
  providerNames: ReadonlySet<string>,
  env: Record<string, string | undefined> = process.env,
): ParseWorkflowSourceResult {
  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(raw);
  } catch (cause) {
    return { ok: false, reason: reasonOf(cause) };
  }

  const result = workflowSchema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, reason: result.error.message };
  }
  const wf = result.data;

  const missing = validateBundles(wf, config);
  if (missing.length > 0) {
    const list = missing.map((n) => `"${n}"`).join(", ");
    const noun = missing.length === 1 ? "bundle" : "bundles";
    return {
      ok: false,
      reason: `missing ${noun} ${list}: expected <name>/run.sh under ${config.bundlesDir()}`,
    };
  }

  const { unknownProviders, missingPromptFiles } = validateLlmSteps(wf, config, providerNames);
  if (unknownProviders.length > 0) {
    const list = unknownProviders.map((n) => `"${n}"`).join(", ");
    const noun = unknownProviders.length === 1 ? "provider" : "providers";
    // Name the valid set so a wrong guess (a hand-edit or an authoring tool
    // call) self-corrects in one step instead of a blind retry.
    const known =
      providerNames.size > 0
        ? ` (configured providers: ${Array.from(providerNames).sort().join(", ")})`
        : "";
    return { ok: false, reason: `unknown llm ${noun} ${list}: not declared in kiri.yaml${known}` };
  }
  if (missingPromptFiles.length > 0) {
    const list = missingPromptFiles.map((n) => `"${n}"`).join(", ");
    const noun = missingPromptFiles.length === 1 ? "file" : "files";
    return {
      ok: false,
      reason: `missing prompt ${noun} ${list}: resolved against ${config.cwd()}`,
    };
  }

  const unsetEnv = unsetEnvRefs(wf, env);
  if (unsetEnv.length > 0) {
    const noun = unsetEnv.length === 1 ? "var" : "vars";
    return {
      ok: false,
      reason: `unresolved env ${noun} ${unsetEnv.join(", ")}: not set in the kiri process environment (export it, or add it to the workspace .env)`,
    };
  }

  return { ok: true, workflow: wf };
}

/**
 * Scan the workspace's `workflows/` directory for `*.yaml`/`*.yml` files
 * (top-level only — nested files are out of scope by design), run each
 * through {@link parseWorkflowSource}, and collect the results. Per-file
 * failures (parse errors, validation, duplicates, missing bundles) populate
 * `result.failures` and the scan continues; only directory-level errors
 * (e.g. the workflows directory doesn't exist) throw.
 */
export async function loadWorkflows(
  config: ConfigStore,
  providerNames: ReadonlySet<string> = new Set(),
  env: Record<string, string | undefined> = process.env,
): Promise<LoadResult> {
  const dir = config.workflowsDir();
  const files = readdirSync(dir)
    .filter(isYamlFile)
    .map((name) => resolve(dir, name))
    .sort();

  const workflows = new Map<string, WorkflowDefinition>();
  const sources = new Map<string, string>();
  const failures: WorkflowLoadFailure[] = [];

  for (const file of files) {
    let raw: string;
    try {
      raw = readFileSync(file, "utf8");
    } catch (cause) {
      failures.push({ path: file, reason: reasonOf(cause) });
      continue;
    }

    const parsed = parseWorkflowSource(raw, config, providerNames, env);
    if (!parsed.ok) {
      failures.push({ path: file, reason: parsed.reason });
      continue;
    }
    const wf = parsed.workflow;

    const existing = sources.get(wf.name);
    if (existing !== undefined) {
      failures.push({
        path: file,
        reason: `duplicate workflow name "${wf.name}" already defined in ${existing}`,
      });
      continue;
    }
    workflows.set(wf.name, wf);
    sources.set(wf.name, file);
  }

  return { workflows, sources, failures };
}
