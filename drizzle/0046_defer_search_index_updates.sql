ALTER TABLE `messages` ADD `search_pending` integer DEFAULT false NOT NULL;--> statement-breakpoint
DROP TRIGGER IF EXISTS articles_search_insert;--> statement-breakpoint
DROP TRIGGER IF EXISTS articles_search_update;--> statement-breakpoint
DROP TRIGGER IF EXISTS articles_search_delete;--> statement-breakpoint
DROP TRIGGER IF EXISTS messages_search_insert;--> statement-breakpoint
DROP TRIGGER IF EXISTS messages_search_update;--> statement-breakpoint
DROP TRIGGER IF EXISTS messages_search_delete;--> statement-breakpoint
DROP TRIGGER IF EXISTS runs_search_insert;--> statement-breakpoint
DROP TRIGGER IF EXISTS runs_search_update;--> statement-breakpoint
DROP TRIGGER IF EXISTS runs_search_delete;--> statement-breakpoint
DROP TRIGGER IF EXISTS sessions_search_title_update;--> statement-breakpoint
DROP TRIGGER IF EXISTS sessions_search_delete;--> statement-breakpoint
DROP TRIGGER IF EXISTS memories_search_insert;--> statement-breakpoint
DROP TRIGGER IF EXISTS memories_search_update;--> statement-breakpoint
DROP TRIGGER IF EXISTS memories_search_delete;--> statement-breakpoint
DROP TABLE search_fts;--> statement-breakpoint
CREATE TABLE search_documents (
	id INTEGER PRIMARY KEY,
	title TEXT NOT NULL,
	body TEXT NOT NULL,
	entity_type TEXT NOT NULL,
	entity_id TEXT NOT NULL,
	source_id TEXT NOT NULL,
	source_kind TEXT NOT NULL,
	UNIQUE(source_kind, source_id)
);--> statement-breakpoint
CREATE VIRTUAL TABLE search_fts USING fts5(
	title,
	body,
	entity_type UNINDEXED,
	entity_id UNINDEXED,
	source_id UNINDEXED,
	content = 'search_documents',
	content_rowid = 'id',
	tokenize = 'porter unicode61'
);--> statement-breakpoint
CREATE TRIGGER search_documents_insert AFTER INSERT ON search_documents BEGIN
	INSERT INTO search_fts (rowid, title, body, entity_type, entity_id, source_id)
	VALUES (new.id, new.title, new.body, new.entity_type, new.entity_id, new.source_id);
END;--> statement-breakpoint
CREATE TRIGGER search_documents_update AFTER UPDATE ON search_documents BEGIN
	INSERT INTO search_fts (search_fts, rowid, title, body, entity_type, entity_id, source_id)
	VALUES ('delete', old.id, old.title, old.body, old.entity_type, old.entity_id, old.source_id);
	INSERT INTO search_fts (rowid, title, body, entity_type, entity_id, source_id)
	VALUES (new.id, new.title, new.body, new.entity_type, new.entity_id, new.source_id);
END;--> statement-breakpoint
CREATE TRIGGER search_documents_delete AFTER DELETE ON search_documents BEGIN
	INSERT INTO search_fts (search_fts, rowid, title, body, entity_type, entity_id, source_id)
	VALUES ('delete', old.id, old.title, old.body, old.entity_type, old.entity_id, old.source_id);
END;--> statement-breakpoint
CREATE TRIGGER articles_search_insert AFTER INSERT ON articles BEGIN
	INSERT INTO search_documents (title, body, entity_type, entity_id, source_id, source_kind)
	VALUES (new.name, new.content_md, 'article', new.id, new.id, 'article');
END;--> statement-breakpoint
CREATE TRIGGER articles_search_update AFTER UPDATE OF name, content_md ON articles BEGIN
	DELETE FROM search_documents WHERE source_kind = 'article' AND source_id = old.id;
	INSERT INTO search_documents (title, body, entity_type, entity_id, source_id, source_kind)
	VALUES (new.name, new.content_md, 'article', new.id, new.id, 'article');
END;--> statement-breakpoint
CREATE TRIGGER articles_search_delete AFTER DELETE ON articles BEGIN
	DELETE FROM search_documents WHERE source_kind = 'article' AND source_id = old.id;
END;--> statement-breakpoint
CREATE TRIGGER messages_search_insert AFTER INSERT ON messages
WHEN new.search_pending = false
	AND new.role IN ('user', 'assistant')
	AND (SELECT parent_session_id FROM sessions WHERE id = new.session_id) IS NULL
BEGIN
	INSERT INTO search_documents (title, body, entity_type, entity_id, source_id, source_kind)
	SELECT '', body, 'session', new.session_id, new.id, 'message' FROM (
		SELECT (SELECT group_concat(json_extract(je.value, '$.text'), ' ')
			FROM json_each(new.parts) je
			WHERE json_extract(je.value, '$.type') = 'text') AS body
	) WHERE body IS NOT NULL AND body <> '';
END;--> statement-breakpoint
CREATE TRIGGER messages_search_update AFTER UPDATE OF parts, role, session_id, search_pending ON messages
WHEN new.search_pending = false
	AND (SELECT parent_session_id FROM sessions WHERE id = new.session_id) IS NULL
BEGIN
	DELETE FROM search_documents WHERE source_kind = 'message' AND source_id = old.id;
	INSERT INTO search_documents (title, body, entity_type, entity_id, source_id, source_kind)
	SELECT '', body, 'session', new.session_id, new.id, 'message' FROM (
		SELECT (SELECT group_concat(json_extract(je.value, '$.text'), ' ')
			FROM json_each(new.parts) je
			WHERE json_extract(je.value, '$.type') = 'text') AS body
	) WHERE new.role IN ('user', 'assistant') AND body IS NOT NULL AND body <> '';
END;--> statement-breakpoint
CREATE TRIGGER messages_search_delete AFTER DELETE ON messages BEGIN
	DELETE FROM search_documents WHERE source_kind = 'message' AND source_id = old.id;
END;--> statement-breakpoint
CREATE TRIGGER runs_search_insert AFTER INSERT ON runs BEGIN
	INSERT INTO search_documents (title, body, entity_type, entity_id, source_id, source_kind)
	SELECT new.workflow_name, new.summary, 'run', new.id, new.id, 'run'
	WHERE new.summary IS NOT NULL AND new.summary <> '';
END;--> statement-breakpoint
CREATE TRIGGER runs_search_update AFTER UPDATE OF workflow_name, summary ON runs BEGIN
	DELETE FROM search_documents WHERE source_kind = 'run' AND source_id = old.id;
	INSERT INTO search_documents (title, body, entity_type, entity_id, source_id, source_kind)
	SELECT new.workflow_name, new.summary, 'run', new.id, new.id, 'run'
	WHERE new.summary IS NOT NULL AND new.summary <> '';
END;--> statement-breakpoint
CREATE TRIGGER runs_search_delete AFTER DELETE ON runs BEGIN
	DELETE FROM search_documents WHERE source_kind = 'run' AND source_id = old.id;
END;--> statement-breakpoint
CREATE TRIGGER sessions_search_title_insert AFTER INSERT ON sessions BEGIN
	INSERT INTO search_documents (title, body, entity_type, entity_id, source_id, source_kind)
	SELECT new.title, '', 'session', new.id, new.id, 'session'
	WHERE new.title IS NOT NULL AND new.title <> '' AND new.parent_session_id IS NULL;
END;--> statement-breakpoint
CREATE TRIGGER sessions_search_title_update AFTER UPDATE OF title ON sessions BEGIN
	DELETE FROM search_documents WHERE source_kind = 'session' AND source_id = old.id;
	INSERT INTO search_documents (title, body, entity_type, entity_id, source_id, source_kind)
	SELECT new.title, '', 'session', new.id, new.id, 'session'
	WHERE new.title IS NOT NULL AND new.title <> '' AND new.parent_session_id IS NULL;
END;--> statement-breakpoint
CREATE TRIGGER sessions_search_delete AFTER DELETE ON sessions BEGIN
	DELETE FROM search_documents WHERE source_kind = 'session' AND source_id = old.id;
END;--> statement-breakpoint
CREATE TRIGGER memories_search_insert AFTER INSERT ON memories BEGIN
	INSERT INTO search_documents (title, body, entity_type, entity_id, source_id, source_kind)
	VALUES (new.name || ' ' || new.description, new.content_md, 'memory', new.id, new.id, 'memory');
END;--> statement-breakpoint
CREATE TRIGGER memories_search_update AFTER UPDATE OF name, description, content_md ON memories BEGIN
	DELETE FROM search_documents WHERE source_kind = 'memory' AND source_id = old.id;
	INSERT INTO search_documents (title, body, entity_type, entity_id, source_id, source_kind)
	VALUES (new.name || ' ' || new.description, new.content_md, 'memory', new.id, new.id, 'memory');
END;--> statement-breakpoint
CREATE TRIGGER memories_search_delete AFTER DELETE ON memories BEGIN
	DELETE FROM search_documents WHERE source_kind = 'memory' AND source_id = old.id;
END;--> statement-breakpoint
INSERT INTO search_documents (title, body, entity_type, entity_id, source_id, source_kind)
SELECT name, content_md, 'article', id, id, 'article' FROM articles;--> statement-breakpoint
INSERT INTO search_documents (title, body, entity_type, entity_id, source_id, source_kind)
SELECT '', body, 'session', session_id, id, 'message' FROM (
	SELECT m.id AS id, m.session_id AS session_id,
		(SELECT group_concat(json_extract(je.value, '$.text'), ' ')
		 FROM json_each(m.parts) je
		 WHERE json_extract(je.value, '$.type') = 'text') AS body
	FROM messages m
	WHERE m.role IN ('user', 'assistant') AND m.search_pending = false
		AND NOT EXISTS (
			SELECT 1 FROM sessions s
			WHERE s.id = m.session_id AND s.parent_session_id IS NOT NULL
		)
) WHERE body IS NOT NULL AND body <> '';--> statement-breakpoint
INSERT INTO search_documents (title, body, entity_type, entity_id, source_id, source_kind)
SELECT workflow_name, summary, 'run', id, id, 'run' FROM runs
WHERE summary IS NOT NULL AND summary <> '';--> statement-breakpoint
INSERT INTO search_documents (title, body, entity_type, entity_id, source_id, source_kind)
SELECT title, '', 'session', id, id, 'session' FROM sessions
WHERE title IS NOT NULL AND title <> '' AND parent_session_id IS NULL;--> statement-breakpoint
INSERT INTO search_documents (title, body, entity_type, entity_id, source_id, source_kind)
SELECT name || ' ' || description, content_md, 'memory', id, id, 'memory' FROM memories;
