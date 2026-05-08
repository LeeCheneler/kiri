ALTER TABLE `run_nodes` RENAME TO `run_steps`;--> statement-breakpoint
DROP INDEX IF EXISTS `run_nodes_run_id_idx`;--> statement-breakpoint
CREATE INDEX `run_steps_run_id_idx` ON `run_steps` (`run_id`);
