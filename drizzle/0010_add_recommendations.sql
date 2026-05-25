CREATE TABLE `recommendations` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`index` integer NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`workflow` text NOT NULL,
	`inputs` text,
	`actioned_run_id` text,
	`actioned_at` integer,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actioned_run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `recommendations_run_id_idx` ON `recommendations` (`run_id`);--> statement-breakpoint
CREATE INDEX `recommendations_actioned_run_id_idx` ON `recommendations` (`actioned_run_id`);