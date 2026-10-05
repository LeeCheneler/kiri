CREATE TABLE `session_articles` (
	`session_id` text NOT NULL,
	`article_id` text NOT NULL,
	`last_touched_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`article_id`) REFERENCES `articles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_articles_session_article_unique` ON `session_articles` (`session_id`,`article_id`);--> statement-breakpoint
CREATE INDEX `session_articles_session_touch_idx` ON `session_articles` (`session_id`,`last_touched_at`,`article_id`);--> statement-breakpoint
CREATE INDEX `session_articles_article_id_idx` ON `session_articles` (`article_id`);
--> statement-breakpoint
INSERT INTO `session_articles` (`session_id`, `article_id`, `last_touched_at`)
SELECT `session_id`, `id`, `created_at` FROM `articles` WHERE `session_id` IS NOT NULL;
