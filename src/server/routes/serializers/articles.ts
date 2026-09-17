import type { ArticleSummary } from "../../../shared/api/articles.ts";
/** Serialize an article's listing projection. */
export const serializeArticleSummary = (
  row: Omit<ArticleSummary, "createdAt"> & { createdAt: Date },
): ArticleSummary => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
});
