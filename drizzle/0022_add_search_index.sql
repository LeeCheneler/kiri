CREATE VIRTUAL TABLE search_fts USING fts5(
	title,
	body,
	entity_type UNINDEXED,
	entity_id UNINDEXED,
	source_id UNINDEXED,
	tokenize = 'porter unicode61'
);
--> statement-breakpoint
CREATE TRIGGER articles_search_insert AFTER INSERT ON articles BEGIN
	INSERT INTO search_fts (title, body, entity_type, entity_id, source_id)
	VALUES (new.name, new.content_md, 'article', new.id, new.id);
END;
--> statement-breakpoint
CREATE TRIGGER articles_search_update AFTER UPDATE ON articles BEGIN
	DELETE FROM search_fts WHERE entity_type = 'article' AND source_id = old.id;
	INSERT INTO search_fts (title, body, entity_type, entity_id, source_id)
	VALUES (new.name, new.content_md, 'article', new.id, new.id);
END;
--> statement-breakpoint
CREATE TRIGGER articles_search_delete AFTER DELETE ON articles BEGIN
	DELETE FROM search_fts WHERE entity_type = 'article' AND source_id = old.id;
END;
--> statement-breakpoint
CREATE TRIGGER messages_search_insert AFTER INSERT ON messages BEGIN
	INSERT INTO search_fts (title, body, entity_type, entity_id, source_id)
	SELECT '', body, 'session', new.session_id, new.id FROM (
		SELECT (SELECT group_concat(json_extract(je.value, '$.text'), ' ')
						FROM json_each(new.parts) je
						WHERE json_extract(je.value, '$.type') = 'text') AS body
	) WHERE new.role IN ('user', 'assistant') AND body IS NOT NULL AND body <> '';
END;
--> statement-breakpoint
CREATE TRIGGER messages_search_update AFTER UPDATE ON messages BEGIN
	DELETE FROM search_fts WHERE entity_type = 'session' AND source_id = old.id;
	INSERT INTO search_fts (title, body, entity_type, entity_id, source_id)
	SELECT '', body, 'session', new.session_id, new.id FROM (
		SELECT (SELECT group_concat(json_extract(je.value, '$.text'), ' ')
						FROM json_each(new.parts) je
						WHERE json_extract(je.value, '$.type') = 'text') AS body
	) WHERE new.role IN ('user', 'assistant') AND body IS NOT NULL AND body <> '';
END;
--> statement-breakpoint
CREATE TRIGGER messages_search_delete AFTER DELETE ON messages BEGIN
	DELETE FROM search_fts WHERE entity_type = 'session' AND source_id = old.id;
END;
--> statement-breakpoint
CREATE TRIGGER runs_search_insert AFTER INSERT ON runs BEGIN
	INSERT INTO search_fts (title, body, entity_type, entity_id, source_id)
	SELECT new.workflow_name, new.summary, 'run', new.id, new.id
	WHERE new.summary IS NOT NULL AND new.summary <> '';
END;
--> statement-breakpoint
CREATE TRIGGER runs_search_update AFTER UPDATE ON runs BEGIN
	DELETE FROM search_fts WHERE entity_type = 'run' AND source_id = old.id;
	INSERT INTO search_fts (title, body, entity_type, entity_id, source_id)
	SELECT new.workflow_name, new.summary, 'run', new.id, new.id
	WHERE new.summary IS NOT NULL AND new.summary <> '';
END;
--> statement-breakpoint
CREATE TRIGGER runs_search_delete AFTER DELETE ON runs BEGIN
	DELETE FROM search_fts WHERE entity_type = 'run' AND source_id = old.id;
END;
--> statement-breakpoint
INSERT INTO search_fts (title, body, entity_type, entity_id, source_id)
SELECT name, content_md, 'article', id, id FROM articles;
--> statement-breakpoint
INSERT INTO search_fts (title, body, entity_type, entity_id, source_id)
SELECT '', body, 'session', session_id, id FROM (
	SELECT m.id AS id, m.session_id AS session_id,
		(SELECT group_concat(json_extract(je.value, '$.text'), ' ')
		 FROM json_each(m.parts) je
		 WHERE json_extract(je.value, '$.type') = 'text') AS body
	FROM messages m
	WHERE m.role IN ('user', 'assistant')
) WHERE body IS NOT NULL AND body <> '';
--> statement-breakpoint
INSERT INTO search_fts (title, body, entity_type, entity_id, source_id)
SELECT workflow_name, summary, 'run', id, id FROM runs
WHERE summary IS NOT NULL AND summary <> '';
