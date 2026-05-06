CREATE TABLE `run_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`index` integer NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`output` text,
	`error` text,
	`traces` text,
	`usage` text,
	`materials` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`workflow_name` text NOT NULL,
	`status` text NOT NULL,
	`trigger` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`error` text,
	`definition_snapshot` text NOT NULL
);
