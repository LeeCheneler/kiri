CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`index` integer NOT NULL,
	`role` text NOT NULL,
	`parts` text NOT NULL,
	`usage` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `messages_session_id_idx` ON `messages` (`session_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_name` text NOT NULL,
	`status` text NOT NULL,
	`model` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`error` text,
	`agent_config_snapshot` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`total_tokens` integer DEFAULT 0 NOT NULL
);
