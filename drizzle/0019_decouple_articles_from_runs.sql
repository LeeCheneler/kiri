PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_articles` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text,
	`session_id` text,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`content_md` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "articles_producer_check" CHECK(("run_id" is not null) <> ("session_id" is not null))
);
--> statement-breakpoint
INSERT INTO `__new_articles`("id", "run_id", "session_id", "slug", "name", "content_md", "created_at") SELECT "id", "run_id", NULL, "slug", "name", "content_md", "created_at" FROM `articles`;--> statement-breakpoint
DROP TABLE `articles`;--> statement-breakpoint
ALTER TABLE `__new_articles` RENAME TO `articles`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `articles_run_id_slug_unique` ON `articles` (`run_id`,`slug`) WHERE "run_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `articles_session_id_slug_unique` ON `articles` (`session_id`,`slug`) WHERE "session_id" is not null;--> statement-breakpoint
CREATE INDEX `articles_run_id_idx` ON `articles` (`run_id`);--> statement-breakpoint
CREATE INDEX `articles_session_id_idx` ON `articles` (`session_id`);