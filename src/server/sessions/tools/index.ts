import type { ToolSet } from "ai";
import { webSearchTool } from "./web-search.ts";

/**
 * Build the tool set offered to a session's model. Each tool self-gates on its
 * own single precondition (here: `TAVILY_API_KEY` for `web_search`) and is
 * included only when that holds; an empty set means the turn runs as a plain
 * chat with no tools. This is the seam future tools plug into — add a factory
 * that returns its `tool()` when available, then register it here under its name.
 */
export function createSessionTools(env: Record<string, string | undefined>): ToolSet {
  const tools: ToolSet = {};
  const webSearch = webSearchTool(env);
  if (webSearch) tools.web_search = webSearch;
  return tools;
}

export {
  TAVILY_API_KEY_ENV,
  type WebSearchOutput,
  type WebSearchResult,
  searchTavily,
  webSearchTool,
} from "./web-search.ts";
