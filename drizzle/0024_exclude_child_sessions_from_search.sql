DROP TRIGGER messages_search_insert;--> statement-breakpoint
CREATE TRIGGER messages_search_insert AFTER INSERT ON messages BEGIN
	INSERT INTO search_fts (title, body, entity_type, entity_id, source_id)
	SELECT '', body, 'session', new.session_id, new.id FROM (
		SELECT (SELECT group_concat(json_extract(je.value, '$.text'), ' ')
						FROM json_each(new.parts) je
						WHERE json_extract(je.value, '$.type') = 'text') AS body
	) WHERE new.role IN ('user', 'assistant') AND body IS NOT NULL AND body <> ''
		AND (SELECT parent_session_id FROM sessions WHERE id = new.session_id) IS NULL;
END;
--> statement-breakpoint
DROP TRIGGER messages_search_update;--> statement-breakpoint
CREATE TRIGGER messages_search_update AFTER UPDATE ON messages BEGIN
	DELETE FROM search_fts WHERE entity_type = 'session' AND source_id = old.id;
	INSERT INTO search_fts (title, body, entity_type, entity_id, source_id)
	SELECT '', body, 'session', new.session_id, new.id FROM (
		SELECT (SELECT group_concat(json_extract(je.value, '$.text'), ' ')
						FROM json_each(new.parts) je
						WHERE json_extract(je.value, '$.type') = 'text') AS body
	) WHERE new.role IN ('user', 'assistant') AND body IS NOT NULL AND body <> ''
		AND (SELECT parent_session_id FROM sessions WHERE id = new.session_id) IS NULL;
END;
--> statement-breakpoint
DELETE FROM search_fts WHERE entity_type = 'session' AND entity_id IN (
	SELECT id FROM sessions WHERE parent_session_id IS NOT NULL
);
