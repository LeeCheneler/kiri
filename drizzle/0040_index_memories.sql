CREATE TRIGGER memories_search_insert AFTER INSERT ON memories BEGIN
	INSERT INTO search_fts (title, body, entity_type, entity_id, source_id)
	VALUES (new.name || ' ' || new.description, new.content_md, 'memory', new.id, new.id);
END;
--> statement-breakpoint
CREATE TRIGGER memories_search_update AFTER UPDATE ON memories BEGIN
	DELETE FROM search_fts WHERE entity_type = 'memory' AND source_id = old.id;
	INSERT INTO search_fts (title, body, entity_type, entity_id, source_id)
	VALUES (new.name || ' ' || new.description, new.content_md, 'memory', new.id, new.id);
END;
--> statement-breakpoint
CREATE TRIGGER memories_search_delete AFTER DELETE ON memories BEGIN
	DELETE FROM search_fts WHERE entity_type = 'memory' AND source_id = old.id;
END;
--> statement-breakpoint
INSERT INTO search_fts (title, body, entity_type, entity_id, source_id)
SELECT name || ' ' || description, content_md, 'memory', id, id FROM memories;
