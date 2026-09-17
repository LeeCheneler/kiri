/**
 * One value in a step / article / summariser `env:` map. Either a literal
 * string or a structured reference the runner resolves at spawn time: a
 * declared workflow input (against the run's `inputs` snapshot), an earlier
 * step's stdout (by that step's `id`), an article's markdown
 * (by its `slug`), or a variable in the kiri process environment (by name).
 */
export type EnvValue =
  | string
  | { input: string }
  | { step: string; output?: string }
  | { article: string }
  | { env: string };

/**
 * The `llm:` block of a first-party LLM step. `model` is a `provider:model`
 * id; the prompt is inline (`prompt`) or a workspace-relative file path
 * (`prompt_file`) — exactly one of the two. (Both fields stay optional here:
 * historical definition snapshots can predate the requirement.)
 */
export interface LlmConfigSummary {
  model: string;
  prompt?: string;
  prompt_file?: string;
}

/**
 * A single workflow step as seen by the client. `id` is the optional
 * identifier later steps reference via `{ step: <id> }` env refs, shown
 * beside the step's title when declared. `name` is an optional short label
 * used as the step's title in the Schema tab and run timeline; absent steps
 * fall back to the bundle reference, the script's first line, or the llm
 * model id.
 */
export type WorkflowStepSummary =
  | {
      use: string;
      id?: string;
      name?: string;
      description?: string;
      env?: Record<string, EnvValue>;
      outputs?: string[];
    }
  | {
      sh: string;
      id?: string;
      name?: string;
      description?: string;
      env?: Record<string, EnvValue>;
      outputs?: string[];
    }
  | {
      llm: LlmConfigSummary;
      id?: string;
      name?: string;
      description?: string;
      env?: Record<string, EnvValue>;
    };

/**
 * One `articles:` entry on a workflow summary. `slug` is the URL/identifier;
 * `name` (the display label) is always present — the server applies the
 * schema's titlecase fallback so the client doesn't re-implement it.
 */
export type WorkflowArticleSummary =
  | {
      slug: string;
      name: string;
      description?: string;
      use: string;
      env?: Record<string, EnvValue>;
    }
  | {
      slug: string;
      name: string;
      description?: string;
      sh: string;
      env?: Record<string, EnvValue>;
    }
  | {
      slug: string;
      name: string;
      description?: string;
      llm: LlmConfigSummary;
      env?: Record<string, EnvValue>;
    };

/**
 * One declared input on a workflow summary. Mirrors the YAML schema:
 * `name` is the identifier referenced from a step's `env:` via
 * `{ input: <name> }`; `description` (when present) renders as help text
 * next to the field; `required` gates submit; `default` pre-fills the
 * modal field at open time. When `options` is defined, the input is a
 * picklist — the modal renders a `<select>` constrained to those values
 * and `default` (if set) is guaranteed to be one of them.
 */
export interface WorkflowInputSummary {
  name: string;
  description?: string;
  required?: boolean;
  default?: string;
  options?: string[];
}

/** Workflow summary as returned by `GET /api/workflows`. */
export interface WorkflowSummary {
  name: string;
  /** One-line summary rendered as the deck beneath the workflow title; absent when undeclared. */
  description?: string;
  /** Grouping label rendered as the workflow page eyebrow (e.g. "Dev"); absent when undeclared. */
  group?: string;
  /** Defined when the workflow declares an `inputs:` block; absent otherwise. */
  inputs?: WorkflowInputSummary[];
  steps: WorkflowStepSummary[];
  /** Defined when the workflow has at least one `articles:` entry. */
  articles?: WorkflowArticleSummary[];
  /** Defined when the workflow has a `summarize:` step. */
  summarize?: WorkflowStepSummary;
}
