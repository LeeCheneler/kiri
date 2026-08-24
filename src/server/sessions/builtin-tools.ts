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
  /**
   * Plumbing between kiri's own sessions rather than a capability the user
   * grants: gated like every tool, but kept off the MCP page's listing.
   */
  internal?: boolean;
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
 * user-authored scripts (`run_workflow`, `rerun_workflow`), write files
 * (the workflow and filesystem write tools), or run model-authored commands
 * (`run_command`) ask first. `delegate` runs without prompting because its
 * worker's tools ride this same gating — an ask pauses the worker for the
 * user, so delegation never widens what runs unprompted — and the delegation
 * messaging tools (`message_worker`, `message_parent`) only move text
 * between the conversation's own sessions. Those two are `internal`:
 * inner plumbing of delegation rather than a capability the user grants,
 * so the MCP page's listing leaves them out.
 * A tool whose capability isn't configured (the filesystem tools and
 * `run_command` with no declared sandbox) is withheld from the model
 * regardless of its permission, as are `delegate` and `message_worker`
 * from a child session — a worker can't spawn or steer workers — and
 * `message_parent` from a session with no parent.
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
    name: "delete_article",
    description: "Permanently delete one of the session's articles.",
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
    name: "use_skill",
    description: "Load a skill's instructions for the task at hand.",
    defaultPermission: "allow",
  },
  {
    name: "save_memory",
    description: "Save or update a durable memory for future sessions to recall.",
    defaultPermission: "allow",
  },
  {
    name: "read_memory",
    description: "Load the full body of a saved memory.",
    defaultPermission: "allow",
  },
  {
    name: "delete_memory",
    description: "Delete a saved memory.",
    defaultPermission: "allow",
  },
  {
    name: "update_project_instructions",
    description: "Rewrite the standing instructions of the session's project.",
    defaultPermission: "allow",
  },
  {
    name: "list_tasks",
    description: "List the session's project task list: its visible groups and tasks.",
    defaultPermission: "allow",
  },
  {
    name: "add_task",
    description: "Add a task to the session's project task list.",
    defaultPermission: "allow",
  },
  {
    name: "update_task",
    description: "Mark a project task done, retitle it, edit its note, or move it.",
    defaultPermission: "allow",
  },
  {
    name: "delete_task",
    description: "Delete a task from the session's project task list.",
    defaultPermission: "ask",
  },
  {
    name: "create_task_group",
    description: "Create a group in the session's project task list.",
    defaultPermission: "allow",
  },
  {
    name: "update_task_group",
    description: "Rename, reorder, or hide a group in the session's project task list.",
    defaultPermission: "allow",
  },
  {
    name: "delete_task_group",
    description: "Delete a group and its tasks from the session's project task list.",
    defaultPermission: "ask",
  },
  {
    name: "list_workflows",
    description: "List the workspace's workflows and their declared inputs.",
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
    name: "set_working_directory",
    description: "Move the session's working directory within the allowed directories.",
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
  {
    name: "run_command",
    description: "Run a shell command inside the allowed directories.",
    defaultPermission: "ask",
  },
  {
    name: "delegate",
    description:
      "Delegate a self-contained task to a worker session that runs in the background and messages back.",
    defaultPermission: "allow",
  },
  {
    name: "message_worker",
    description: "Message a delegated worker: steer it, ask for progress, or answer its question.",
    defaultPermission: "allow",
    internal: true,
  },
  {
    name: "message_parent",
    description:
      "Let a delegated worker message the session that delegated its task: progress, questions, and results.",
    defaultPermission: "allow",
    internal: true,
  },
];
