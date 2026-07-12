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
 * prompting (`allow` — the request in chat is the authorisation), as do the
 * filesystem read tools (reads confined to the sandbox the user declared in
 * `kiri.yaml` — declaring it is the authorisation), while tools that execute
 * user-authored scripts (`run_workflow`, `rerun_workflow`) or write files
 * (the workflow and filesystem write tools) ask first. A tool whose
 * capability isn't configured (the filesystem tools with no declared sandbox)
 * is withheld from the model regardless of its permission.
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
    name: "generate_image",
    description: "Generate an image with the session's selected image model.",
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
  {
    name: "find_files",
    description: "Find files by glob pattern in the allowed directories.",
    defaultPermission: "allow",
  },
  {
    name: "list_directory",
    description: "List a directory's immediate entries in the allowed directories.",
    defaultPermission: "allow",
  },
  {
    name: "read_file",
    description: "Read a text file from the allowed directories.",
    defaultPermission: "allow",
  },
  {
    name: "search_files",
    description: "Search file contents in the allowed directories.",
    defaultPermission: "allow",
  },
  {
    name: "write_file",
    description: "Create or overwrite a text file in the allowed directories.",
    defaultPermission: "ask",
  },
  {
    name: "edit_file",
    description: "Make a targeted text replacement in a file in the allowed directories.",
    defaultPermission: "ask",
  },
  {
    name: "create_directory",
    description: "Create a directory in the allowed directories.",
    defaultPermission: "ask",
  },
  {
    name: "delete_file",
    description: "Delete a file in the allowed directories.",
    defaultPermission: "ask",
  },
  {
    name: "delete_directory",
    description: "Delete a directory in the allowed directories.",
    defaultPermission: "ask",
  },
];
