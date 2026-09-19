/**
 * One piece of a search-result snippet. `match` marks the pieces that hit a
 * query term so the UI can highlight them.
 */
export interface SearchSnippetSegment {
  text: string;
  match: boolean;
}

/** An article search hit. `runId`/`sessionId`/`projectId` name the owner — exactly one is set. */
export interface SearchArticleHit {
  id: string;
  slug: string;
  name: string;
  runId: string | null;
  sessionId: string | null;
  projectId: string | null;
  snippet: SearchSnippetSegment[];
}

/** A session search hit: its title (null when untitled), feed preview (empty when titled or nothing has been sent), and the best-ranked matching message. */
export interface SearchSessionHit {
  id: string;
  title: string | null;
  preview: string;
  snippet: SearchSnippetSegment[];
}

/** A run search hit, matched on its summary. */
export interface SearchRunHit {
  id: string;
  workflowName: string;
  snippet: SearchSnippetSegment[];
}

/** A workflow-definition search hit, matched on name/description/group. */
export interface SearchWorkflowHit {
  name: string;
  description?: string;
  group?: string;
}

/** Grouped results from `GET /api/search`. */
export interface SearchResults {
  articles: SearchArticleHit[];
  sessions: SearchSessionHit[];
  runs: SearchRunHit[];
  workflows: SearchWorkflowHit[];
}

/** Full-text query and optional result limit. */
export interface SearchQuery {
  q: string;
  limit?: number;
}
