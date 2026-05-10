ALTER TABLE `run_steps` ADD `is_summary` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `runs` ADD `summary` text;