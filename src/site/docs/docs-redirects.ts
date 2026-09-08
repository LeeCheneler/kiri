const MOVED_SECTIONS: Record<string, { target: string; anchors: string[] }> = {
  sessions: {
    target: "session-reference",
    anchors: [
      "shaping-behaviour",
      "skills",
      "memories-and-projects",
      "effort",
      "tools-from-mcp-servers",
      "tool-permissions",
      "running-workflows",
      "authoring-workflows",
      "generating-images",
      "working-with-your-files",
      "running-shell-commands",
      "delegating-research",
      "context-and-cost",
      "attachments",
      "titles",
      "suggested-replies",
      "push-to-talk",
      "desktop-notifications",
    ],
  },
  workflows: {
    target: "workflow-authoring",
    anchors: [
      "start-with-a-shell-step",
      "wire-steps-together",
      "add-a-model-step",
      "publish-an-article",
      "summarise-the-run",
      "take-inputs",
      "name-your-outputs",
      "recommend-follow-ups",
      "grow-a-step-into-a-bundle",
      "next",
    ],
  },
};

/** Preserve bookmarks to detailed sections moved from guides into reference pages. */
export function movedDocsHref(slug: string, hash: string): string | undefined {
  const move = MOVED_SECTIONS[slug];
  return move?.anchors?.includes(hash.slice(1)) ? `/docs/${move.target}${hash}` : undefined;
}
