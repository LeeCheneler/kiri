import type { Database } from "bun:sqlite";
import { extractFirstHeading } from "../../shared/extract-first-heading.ts";

/**
 * Fill `articles.heading` for rows written before the column existed. The
 * heading rules live in code, so SQL alone cannot derive it. Articles without
 * a heading keep the column's null.
 */
export function backfillArticleHeadings(sqlite: Database): void {
  const rows = sqlite
    .query<{ id: string; content_md: string }, []>("SELECT id, content_md FROM articles")
    .all();
  const update = sqlite.prepare("UPDATE articles SET heading = ? WHERE id = ?");

  for (const row of rows) {
    const heading = extractFirstHeading(row.content_md);
    if (heading !== null) update.run(heading, row.id);
  }
}
