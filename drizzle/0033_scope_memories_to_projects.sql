DROP INDEX `memories_name_unique`;--> statement-breakpoint
ALTER TABLE `memories` ADD `project_id` text REFERENCES projects(id);--> statement-breakpoint
CREATE UNIQUE INDEX `memories_project_id_name_unique` ON `memories` (`project_id`,`name`) WHERE "project_id" is not null;--> statement-breakpoint
CREATE INDEX `memories_project_id_idx` ON `memories` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `memories_name_unique` ON `memories` (`name`) WHERE "project_id" is null;