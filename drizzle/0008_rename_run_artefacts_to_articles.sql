ALTER TABLE `run_artefacts` RENAME TO `articles`;--> statement-breakpoint
DROP INDEX IF EXISTS `run_artefacts_run_id_name_unique`;--> statement-breakpoint
DROP INDEX IF EXISTS `run_artefacts_run_id_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `articles_run_id_name_unique` ON `articles` (`run_id`,`name`);--> statement-breakpoint
CREATE INDEX `articles_run_id_idx` ON `articles` (`run_id`);
