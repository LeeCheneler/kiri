CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_articles` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text,
	`session_id` text,
	`project_id` text,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`content_md` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "articles_producer_check" CHECK((("run_id" is not null) + ("session_id" is not null) + ("project_id" is not null)) = 1)
);
--> statement-breakpoint
INSERT INTO `__new_articles`("id", "run_id", "session_id", "project_id", "slug", "name", "content_md", "created_at") SELECT "id", "run_id", "session_id", NULL, "slug", "name", "content_md", "created_at" FROM `articles`;--> statement-breakpoint
DROP TABLE `articles`;--> statement-breakpoint
ALTER TABLE `__new_articles` RENAME TO `articles`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `articles_run_id_slug_unique` ON `articles` (`run_id`,`slug`) WHERE "run_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `articles_session_id_slug_unique` ON `articles` (`session_id`,`slug`) WHERE "session_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `articles_project_id_slug_unique` ON `articles` (`project_id`,`slug`) WHERE "project_id" is not null;--> statement-breakpoint
CREATE INDEX `articles_run_id_idx` ON `articles` (`run_id`);--> statement-breakpoint
CREATE INDEX `articles_session_id_idx` ON `articles` (`session_id`);--> statement-breakpoint
CREATE INDEX `articles_project_id_idx` ON `articles` (`project_id`);--> statement-breakpoint
-- Dropping the old articles table dropped its search triggers (its search_fts
-- rows survive, so no backfill); recreate them against the rebuilt table.
CREATE TRIGGER articles_search_insert AFTER INSERT ON articles BEGIN
	INSERT INTO search_fts (title, body, entity_type, entity_id, source_id)
	VALUES (new.name, new.content_md, 'article', new.id, new.id);
END;
--> statement-breakpoint
CREATE TRIGGER articles_search_update AFTER UPDATE ON articles BEGIN
	DELETE FROM search_fts WHERE entity_type = 'article' AND source_id = old.id;
	INSERT INTO search_fts (title, body, entity_type, entity_id, source_id)
	VALUES (new.name, new.content_md, 'article', new.id, new.id);
END;
--> statement-breakpoint
CREATE TRIGGER articles_search_delete AFTER DELETE ON articles BEGIN
	DELETE FROM search_fts WHERE entity_type = 'article' AND source_id = old.id;
END;
--> statement-breakpoint
ALTER TABLE `sessions` ADD `project_id` text REFERENCES projects(id);