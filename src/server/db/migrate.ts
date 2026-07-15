import migration0000 from "../../../drizzle/0000_initial.sql" with { type: "text" };
import migration0001 from "../../../drizzle/0001_index_run_nodes_run_id.sql" with { type: "text" };
import migration0002 from "../../../drizzle/0002_rename_run_nodes_to_run_steps.sql" with {
  type: "text",
};
import migration0003 from "../../../drizzle/0003_add_run_summary_columns.sql" with { type: "text" };
import migration0004 from "../../../drizzle/0004_add_publish_support.sql" with { type: "text" };
import migration0005 from "../../../drizzle/0005_add_run_git_columns.sql" with { type: "text" };
import migration0006 from "../../../drizzle/0006_drop_step_materials.sql" with { type: "text" };
import migration0007 from "../../../drizzle/0007_drop_step_usage.sql" with { type: "text" };
import migration0008 from "../../../drizzle/0008_rename_run_artefacts_to_articles.sql" with {
  type: "text",
};
import migration0009 from "../../../drizzle/0009_add_run_inputs.sql" with { type: "text" };
import migration0010 from "../../../drizzle/0010_add_recommendations.sql" with { type: "text" };
import migration0011 from "../../../drizzle/0011_drop_run_trigger.sql" with { type: "text" };
import migration0012 from "../../../drizzle/0012_add_run_step_timing.sql" with { type: "text" };
import migration0013 from "../../../drizzle/0013_rename_article_columns.sql" with { type: "text" };
import migration0014 from "../../../drizzle/0014_add_sessions_and_messages.sql" with {
  type: "text",
};
import migration0015 from "../../../drizzle/0015_drop_session_agent_columns.sql" with {
  type: "text",
};
import migration0016 from "../../../drizzle/0016_add_session_persona.sql" with { type: "text" };
import migration0017 from "../../../drizzle/0017_drop_session_token_totals.sql" with {
  type: "text",
};
import migration0018 from "../../../drizzle/0018_rename_is_publish_to_is_article.sql" with {
  type: "text",
};
import migration0019 from "../../../drizzle/0019_decouple_articles_from_runs.sql" with {
  type: "text",
};
import migration0020 from "../../../drizzle/0020_add_session_pinned.sql" with { type: "text" };
import migration0021 from "../../../drizzle/0021_add_session_image_model.sql" with { type: "text" };
import migration0022 from "../../../drizzle/0022_add_search_index.sql" with { type: "text" };
import type { KiriDb } from "./index.ts";

interface Migration {
  name: string;
  sql: string;
}

/**
 * Append-only list of migrations applied at startup, in order. To add a
 * new migration: edit the schema, run `bun db:generate` to produce the
 * SQL file under `drizzle/`, then add a corresponding text import above
 * and an entry here. Names are matched exactly against `__kiri_migrations`
 * — don't rename existing entries after they've shipped.
 *
 * `0002_rename_run_nodes_to_run_steps`,
 * `0008_rename_run_artefacts_to_articles`, and
 * `0013_rename_article_columns`, plus their meta snapshots, were
 * hand-written: drizzle-kit's rename-detection prompt is
 * interactive-only. The next auto-generated migration may need its
 * `prevId` adjusted to chain off `drizzle/meta/0013_snapshot.json`.
 *
 * `0022_add_search_index` (and its meta snapshot) is also hand-written:
 * FTS5 virtual tables and triggers can't be modelled in the drizzle
 * schema, so `search_fts` exists only in SQL. It mirrors `articles`,
 * `messages` (user/assistant text parts), and `runs` (summaries) via
 * triggers — schema changes to those tables must keep the triggers in
 * step.
 */
const MIGRATIONS: Migration[] = [
  { name: "0000_initial", sql: migration0000 },
  { name: "0001_index_run_nodes_run_id", sql: migration0001 },
  { name: "0002_rename_run_nodes_to_run_steps", sql: migration0002 },
  { name: "0003_add_run_summary_columns", sql: migration0003 },
  { name: "0004_add_publish_support", sql: migration0004 },
  { name: "0005_add_run_git_columns", sql: migration0005 },
  { name: "0006_drop_step_materials", sql: migration0006 },
  { name: "0007_drop_step_usage", sql: migration0007 },
  { name: "0008_rename_run_artefacts_to_articles", sql: migration0008 },
  { name: "0009_add_run_inputs", sql: migration0009 },
  { name: "0010_add_recommendations", sql: migration0010 },
  { name: "0011_drop_run_trigger", sql: migration0011 },
  { name: "0012_add_run_step_timing", sql: migration0012 },
  { name: "0013_rename_article_columns", sql: migration0013 },
  { name: "0014_add_sessions_and_messages", sql: migration0014 },
  { name: "0015_drop_session_agent_columns", sql: migration0015 },
  { name: "0016_add_session_persona", sql: migration0016 },
  { name: "0017_drop_session_token_totals", sql: migration0017 },
  { name: "0018_rename_is_publish_to_is_article", sql: migration0018 },
  { name: "0019_decouple_articles_from_runs", sql: migration0019 },
  { name: "0020_add_session_pinned", sql: migration0020 },
  { name: "0021_add_session_image_model", sql: migration0021 },
  { name: "0022_add_search_index", sql: migration0022 },
];

/**
 * Apply any unapplied migrations to `db`. Idempotent: applied migrations
 * are tracked by name in `__kiri_migrations` and skipped on re-run.
 *
 * Migration SQL is bundled into the binary via Bun text imports (see the
 * imports above) so this works inside `bun build --compile` artifacts
 * where no filesystem `drizzle/` folder exists.
 */
export function migrate(db: KiriDb): void {
  const sqlite = db.$client;
  sqlite.run(
    "CREATE TABLE IF NOT EXISTS __kiri_migrations (name TEXT PRIMARY KEY NOT NULL, applied_at INTEGER NOT NULL)",
  );
  const applied = new Set(
    sqlite
      .query<{ name: string }, []>("SELECT name FROM __kiri_migrations")
      .all()
      .map((r) => r.name),
  );

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.name)) continue;
    // drizzle-kit emits `--> statement-breakpoint` between statements;
    // bun:sqlite's `.run()` is single-statement, so split and run each.
    // Assumes the marker only appears as drizzle-kit's separator — if a
    // future migration includes it as a string literal or comment, switch
    // to a SQL-aware splitter.
    const statements = migration.sql
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    sqlite.transaction(() => {
      for (const statement of statements) {
        sqlite.run(statement);
      }
      sqlite
        .prepare("INSERT INTO __kiri_migrations (name, applied_at) VALUES (?, ?)")
        .run(migration.name, Date.now());
    })();
  }
}
