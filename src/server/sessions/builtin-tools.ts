import type { ToolPermission } from "./tool-permissions.ts";

/**
 * A first-party session tool's entry in the standing-permission surface: its
 * name as the model calls it, a management-surface blurb (not the model-facing
 * tool description), and the standing permission that applies until the user
 * records one.
 */
export interface BuiltinTool {
  name: string;
  description: string;
  defaultPermission: ToolPermission;
}

/**
 * Every first-party session tool, in the order the MCP page lists them. Each
 * rides the same standing tool-permission machinery as an MCP tool — the
 * session routes gate each listed tool per call, and the MCP page's Built-in
 * tools card shows its permission for review and change. Defaults encode the
 * trust posture: tools that only read or write kiri's own data run without
 * prompting (`allow` — the request in chat is the authorisation), while
 * tools that execute user-authored scripts (`run_workflow`, `rerun_workflow`)
 * or write files into the workspace repo (the workflow write tools) ask
 * first.
 */
export const BUILTIN_TOOLS: readonly BuiltinTool[] = [
  {
    name: "create_article",
    description: "Create an article: a standalone markdown document saved outside the chat.",
    defaultPermission: "allow",
  },
  {
    name: "replace_article",
    description: "Rewrite the entire body of one of the session's articles.",
    defaultPermission: "allow",
  },
  {
    name: "edit_article",
    description: "Make a targeted text replacement in one of the session's articles.",
    defaultPermission: "allow",
  },
  {
    name: "list_articles",
    description: "List the articles the session has written so far.",
    defaultPermission: "allow",
  },
  {
    name: "read_article",
    description: "Read the full body of a session article or one a workflow run produced.",
    defaultPermission: "allow",
  },
  {
    name: "list_workflows",
    description: "List the workspace's workflows and their declared inputs.",
    defaultPermission: "allow",
  },
  {
    name: "read_workflow_authoring_guide",
    description: "Return kiri's workflow-authoring reference for the session to follow.",
    defaultPermission: "allow",
  },
  {
    name: "read_workflow",
    description: "Read the raw YAML of one of the workspace's workflows.",
    defaultPermission: "allow",
  },
  {
    name: "create_workflow",
    description: "Write a new workflow YAML file into the workspace.",
    defaultPermission: "ask",
  },
  {
    name: "edit_workflow",
    description: "Make a targeted text replacement in a workflow's YAML file.",
    defaultPermission: "ask",
  },
  {
    name: "replace_workflow",
    description: "Rewrite a workflow's YAML file wholesale.",
    defaultPermission: "ask",
  },
  {
    name: "run_workflow",
    description: "Run one of the workspace's workflows and wait for it to finish.",
    defaultPermission: "ask",
  },
  {
    name: "rerun_workflow",
    description: "Re-execute an existing run in place, replacing its results in the feed.",
    defaultPermission: "ask",
  },
];
