import { type ToolSet, tool } from "ai";
import { z } from "zod";
import type { ConfigStore } from "../config/store.ts";
import { listSkills } from "./skills.ts";

/**
 * The first-party `use_skill` tool: returns a skill's full instructions by
 * name, from the workspace's `skills/` directory or kiri's own first-party
 * set. Read-only — skills are discovered fresh on every call, so an edited
 * skill serves its current content. An unknown name throws with the available
 * names, surfaced as a tool error the model corrects from.
 */
export function skillTools(config: ConfigStore): ToolSet {
  return {
    use_skill: tool({
      description:
        "Load a skill: a named instruction set for a specific kind of task, kept in this workspace or shipped with kiri. The system prompt lists the available skills with a one-line description of each. When the task at hand matches a listed skill, call this before starting that work and follow the returned instructions — they are authoritative and more detailed than any tool description. Call it at most once per skill per conversation: the content stays in the conversation, so don't reload it.",
      inputSchema: z.object({
        name: z
          .string()
          .min(1)
          .describe("Name of the skill to load, exactly as the system prompt lists it."),
      }),
      execute: async ({ name }) => {
        const skills = listSkills(config);
        const skill = skills.find((entry) => entry.name === name);
        if (!skill) {
          const known = skills.map((entry) => `"${entry.name}"`).join(", ");
          throw new Error(`No skill named "${name}" — available skills: ${known}.`);
        }
        return skill.load();
      },
    }),
  };
}
