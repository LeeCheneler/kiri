import { type ToolSet, tool } from "ai";
import { z } from "zod";
import {
  type KnowledgeScope,
  MAX_KNOWLEDGE_BYTES,
  knowledgeReferenceSchema,
  knowledgeScopeSchema,
  openKnowledge,
  searchKnowledge,
} from "../search/knowledge.ts";
import type { SearchDeps } from "../search/search.ts";

/** Read saved workspace knowledge, defaulting to the session's project when it has one. */
export function knowledgeTools(deps: SearchDeps, projectId: string | null): ToolSet {
  const defaultScope: KnowledgeScope = projectId === null ? "workspace" : { projectId };
  const scope = knowledgeScopeSchema
    .optional()
    .describe(
      `Default: ${JSON.stringify(defaultScope)}. Workspace includes all projects; project excludes global records.`,
    );
  return {
    search_knowledge: tool({
      description:
        "Search articles, sessions, memories, run summaries and workflows. Returns source references. Page with nextOffset, preserving query/scope/filters.",
      inputSchema: z.object({
        query: z.string().max(1000),
        scope,
        session_id: z.string().min(1).optional().describe("Filter to one session."),
        limit: z.number().int().min(1).max(20).optional().describe("Default 10 hits."),
        offset: z
          .number()
          .int()
          .nonnegative()
          .max(Number.MAX_SAFE_INTEGER)
          .optional()
          .describe("Default zero; nextOffset continues."),
      }),
      execute: async ({ query, scope, session_id, limit, offset }) =>
        searchKnowledge(deps, {
          query,
          scope: scope ?? defaultScope,
          sessionId: session_id,
          limit,
          offset,
        }),
    }),
    open_knowledge: tool({
      description:
        "Read saved text near a session anchor, otherwise from the beginning. Up to five messages; no tools/reasoning/images. Runs: summary/status. Workflows: current definition. Follow previous/next reference and offset; preserve scope.",
      inputSchema: z.object({
        reference: knowledgeReferenceSchema.describe("From search or previous/next."),
        scope,
        offset: z
          .number()
          .int()
          .nonnegative()
          .max(Number.MAX_SAFE_INTEGER)
          .optional()
          .describe("Unicode code-point offset; omit for the search anchor."),
        max_bytes: z
          .number()
          .int()
          .min(256)
          .max(MAX_KNOWLEDGE_BYTES)
          .optional()
          .describe(
            `UTF-8 text-byte budget; default ${MAX_KNOWLEDGE_BYTES}, plus metadata. Not tokens.`,
          ),
      }),
      execute: async ({ reference, scope, offset, max_bytes }) =>
        openKnowledge(deps, {
          reference,
          scope: scope ?? defaultScope,
          offset,
          maxBytes: max_bytes,
        }),
    }),
  };
}
