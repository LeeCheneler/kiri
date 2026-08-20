import { type JSONValue, type ToolSet, tool } from "ai";
import { z } from "zod";
import type { KiriDb } from "../db/index.ts";
import type { KiriEvent } from "../events/index.ts";
import { getProject, updateProject } from "../projects/store.ts";
import { MAX_DIFF_LENGTH, compactWriteOutput, unifiedDiff } from "./write-tool-diffs.ts";

/**
 * The first-party tool that lets a project session rewrite its project's
 * standing instructions — the layer every session in the project carries,
 * between the workspace's instructions and any directory chain. Offered only
 * to a session inside a project; a projectless session gets nothing.
 *
 * The write is wholesale, matching the project page's editor: the current
 * instructions are already in the session's own prompt, so the model has what
 * it needs to rewrite them without a read tool. A blank body clears them. The
 * result carries a unified diff of the change for the transcript to render —
 * stripped before the model sees it, like the filesystem write tools — and
 * publishes `project.updated` so open views refresh.
 */
export function projectTools(
  db: KiriDb,
  projectId: string | null,
  publish: (event: KiriEvent) => void,
): ToolSet {
  if (projectId === null) return {};

  return {
    update_project_instructions: tool({
      description:
        'Rewrite this project\'s standing instructions: the markdown carried by every session in the project, which you can read in your own instructions above. Call this ONLY when the user has explicitly asked for the project\'s instructions to be changed — a direct request like "add that to the project instructions" or "drop the British English rule from the project". Never call it on your own initiative: not to record something you inferred, not to note a preference the user expressed in passing, not to tidy wording you find unclear, and not because a task would be easier next time if the instructions said something. Those belong in your reply, or in a memory. This rewrites the whole body, so carry every part the user is not changing through verbatim, and change only what they asked for. A blank body clears the instructions entirely — only ever on an explicit request to remove them.',
      inputSchema: z.object({
        instructions_md: z
          .string()
          .describe(
            "The project's complete instructions in markdown, replacing whatever is there now — the unchanged parts included verbatim. Pass an empty string to clear them.",
          ),
      }),
      execute: async ({ instructions_md }) => {
        const project = getProject(db, projectId);
        if (!project) {
          throw new Error(
            "This session's project no longer exists — its instructions can't be updated.",
          );
        }
        const before = project.instructions ?? "";
        const updated = updateProject(db, projectId, { instructions: instructions_md });
        const after = updated.instructions ?? "";
        publish({ type: "project.updated", id: projectId });
        return {
          project: updated.name,
          instructions: after === "" ? "cleared" : "updated",
          applies: "from your next turn — the instructions are re-read each turn",
          ...unifiedDiff(before, after, MAX_DIFF_LENGTH),
        };
      },
      toModelOutput: ({ output }) => ({
        type: "json" as const,
        value: compactWriteOutput(output) as JSONValue,
      }),
    }),
  };
}
