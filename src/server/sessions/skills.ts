import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ConfigStore } from "../config/store.ts";
import { type HostEnvironment, detectHostEnvironment } from "./host-environment.ts";
import { buildWorkflowAuthoringGuide } from "./workflow-authoring-guide.ts";

/** What the system prompt lists per skill: its name and one-line description. */
export interface SkillSummary {
  name: string;
  description: string;
}

/** A skill: a named instruction set loaded into the conversation on demand via `use_skill`. */
export interface Skill extends SkillSummary {
  /** The skill's full instructions — the `SKILL.md` body, or a first-party skill's generated text. */
  load: () => string;
}

// The skills kiri itself ships, listed alongside the user's. The
// workflow-authoring reference is generated per host rather than read from a
// file, so its shell rules always match the machine the workflows run on.
const firstPartySkills = (host: HostEnvironment): Skill[] => [
  {
    name: "workflow-authoring",
    description:
      "Author kiri workflows: the YAML file shape, step kinds, data-flow and env rules, and the working method. Load before creating or editing any workflow.",
    load: () => buildWorkflowAuthoringGuide(host),
  },
];

// Split a SKILL.md into its frontmatter fields and body. Tolerant by design:
// no frontmatter means the whole file is the body, unknown fields are simply
// unread, and unparseable frontmatter degrades to no fields — so a skill
// written for another tool drops in unmodified.
const parseSkillFile = (raw: string): { fields: Record<string, unknown>; body: string } => {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw);
  if (!match) return { fields: {}, body: raw.trim() };
  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(match[1]);
  } catch {
    parsed = null;
  }
  const fields =
    typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  return { fields, body: raw.slice(match[0].length).trim() };
};

/**
 * Discover the skills available to sessions: kiri's first-party skills plus
 * the workspace's own, one directory per skill under `skills/<name>/SKILL.md`
 * in the config repo. The frontmatter `name` (defaulting to the directory
 * name) keys the skill and `description` feeds the system-prompt listing; a
 * user skill sharing a first-party skill's name replaces it. Read fresh per
 * call, so an edit applies on the next turn; a directory without a readable
 * `SKILL.md` is skipped rather than failing discovery.
 */
export function listSkills(
  config: ConfigStore,
  host: HostEnvironment = detectHostEnvironment(),
): Skill[] {
  const byName = new Map<string, Skill>();
  for (const skill of firstPartySkills(host)) byName.set(skill.name, skill);

  const dir = config.skillsDir();
  if (existsSync(dir)) {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (!entry.isDirectory()) continue;
      const file = join(dir, entry.name, "SKILL.md");
      let raw: string;
      try {
        raw = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      const { fields, body } = parseSkillFile(raw);
      const name =
        typeof fields.name === "string" && fields.name.trim() !== ""
          ? fields.name.trim()
          : entry.name;
      const description = typeof fields.description === "string" ? fields.description.trim() : "";
      byName.set(name, { name, description, load: () => body });
    }
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
