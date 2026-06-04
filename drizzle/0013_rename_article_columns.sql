ALTER TABLE `articles` RENAME COLUMN `name` TO `slug`;--> statement-breakpoint
ALTER TABLE `articles` RENAME COLUMN `title` TO `name`;--> statement-breakpoint
DROP INDEX IF EXISTS `articles_run_id_name_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `articles_run_id_slug_unique` ON `articles` (`run_id`,`slug`);