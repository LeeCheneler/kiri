DROP INDEX IF EXISTS `messages_session_id_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `messages_session_id_index_unique` ON `messages` (`session_id`,`index`);--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_parent_tool_call_unique` ON `sessions` (`parent_session_id`,`parent_tool_call_id`) WHERE "parent_session_id" is not null;
