ALTER TABLE `sessions` ADD `title` text;--> statement-breakpoint
CREATE TRIGGER sessions_search_title_update AFTER UPDATE OF title ON sessions BEGIN
	DELETE FROM search_fts WHERE entity_type = 'session' AND source_id = old.id;
	INSERT INTO search_fts (title, body, entity_type, entity_id, source_id)
	SELECT new.title, '', 'session', new.id, new.id
	WHERE new.title IS NOT NULL AND new.title <> '' AND new.parent_session_id IS NULL;
END;
--> statement-breakpoint
CREATE TRIGGER sessions_search_delete AFTER DELETE ON sessions BEGIN
	DELETE FROM search_fts WHERE entity_type = 'session' AND source_id = old.id;
END;
