import type { ToolSet } from "ai";
import { webExtractTool } from "./web-extract.ts";
import { webSearchTool } from "./web-search.ts";

/**
 * Build the tool set offered to a session's model. Each tool self-gates on its
 * own single precondition (here: `TAVILY_API_KEY` for `web_search` and
 * `web_extract`) and is included only when that holds; an empty set means the
 * turn runs as a plain chat with no tools. This is the seam future tools plug
 * into — add a factory that returns its `tool()` when available, then register
 * it here under its name.
 */
export function createSessionTools(env: Record<string, string | undefined>): ToolSet {
  const tools: ToolSet = {};
  const webSearch = webSearchTool(env);
  if (webSearch) tools.web_search = webSearch;
  const webExtract = webExtractTool(env);
  if (webExtract) tools.web_extract = webExtract;
  return tools;
}

export { TAVILY_API_KEY_ENV } from "./tavily.ts";
export {
  type WebSearchOutput,
  type WebSearchResult,
  searchTavily,
  webSearchTool,
} from "./web-search.ts";
export {
  type WebExtractOutput,
  type WebExtractResult,
  type WebExtractFailure,
  extractTavily,
  webExtractTool,
} from "./web-extract.ts";
