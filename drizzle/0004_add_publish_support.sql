CREATE TABLE `run_artefacts` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`name` text NOT NULL,
	`title` text NOT NULL,
	`content_md` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `run_artefacts_run_id_name_unique` ON `run_artefacts` (`run_id`,`name`);--> statement-breakpoint
CREATE INDEX `run_artefacts_run_id_idx` ON `run_artefacts` (`run_id`);--> statement-breakpoint
ALTER TABLE `run_steps` ADD `is_publish` integer DEFAULT false NOT NULL;