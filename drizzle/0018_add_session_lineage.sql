ALTER TABLE `sessions` ADD `parent_session_id` text REFERENCES sessions(id);--> statement-breakpoint
ALTER TABLE `sessions` ADD `parent_tool_call_id` text;--> statement-breakpoint
CREATE INDEX `sessions_parent_session_id_idx` ON `sessions` (`parent_session_id`);