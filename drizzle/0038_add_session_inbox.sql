CREATE TABLE `session_inbox` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`source` text NOT NULL,
	`text` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `session_inbox_session_id_idx` ON `session_inbox` (`session_id`);
