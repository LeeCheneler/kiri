ALTER TABLE `messages` ADD `context_tokens` integer;--> statement-breakpoint
UPDATE `messages` SET `context_tokens` = json_extract(`usage`, '$.contextTokens') WHERE `usage` IS NOT NULL;--> statement-breakpoint
ALTER TABLE `messages` DROP COLUMN `usage`;--> statement-breakpoint
ALTER TABLE `sessions` DROP COLUMN `input_tokens`;--> statement-breakpoint
ALTER TABLE `sessions` DROP COLUMN `output_tokens`;--> statement-breakpoint
ALTER TABLE `sessions` DROP COLUMN `total_tokens`;