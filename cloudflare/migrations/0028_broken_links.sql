ALTER TABLE bookmarks ADD COLUMN broken_state TEXT NOT NULL DEFAULT 'unknown' CHECK(broken_state IN ('unknown', 'ok', 'broken', 'uncertain'));
ALTER TABLE bookmarks ADD COLUMN broken_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE bookmarks ADD COLUMN broken_http_status INTEGER;
ALTER TABLE bookmarks ADD COLUMN broken_final_url TEXT NOT NULL DEFAULT '';
ALTER TABLE bookmarks ADD COLUMN broken_checked_at INTEGER;
ALTER TABLE bookmarks ADD COLUMN broken_next_check_at INTEGER;
ALTER TABLE bookmarks ADD COLUMN broken_failure_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bookmarks ADD COLUMN broken_check_version INTEGER NOT NULL DEFAULT 0;

UPDATE bookmarks SET broken_state = CASE WHEN broken = 1 THEN 'broken' ELSE 'unknown' END;

CREATE INDEX bookmarks_broken_due
ON bookmarks(user_id, removed_at, broken_next_check_at);

DROP TRIGGER IF EXISTS bookmarks_after_update;

CREATE TRIGGER bookmarks_after_update
AFTER UPDATE OF url, title, collection_id, tags, highlights, description, note, cover, media, reminder, important, type, lang, broken, broken_state, broken_reason, broken_http_status, broken_final_url, broken_checked_at, broken_next_check_at, broken_failure_count, broken_check_version, duplicate, removed_at, removed_batch, updated_at ON bookmarks
WHEN NEW.change_version = OLD.change_version
BEGIN
    INSERT INTO bookmark_changes (user_id, bookmark_id, action, changed_at)
    VALUES (
        NEW.user_id,
        NEW.id,
        CASE WHEN NEW.removed_at IS NOT NULL AND OLD.removed_at IS NULL THEN 'remove' ELSE 'update' END,
        NEW.updated_at
    );
    UPDATE bookmarks
    SET change_version = last_insert_rowid()
    WHERE id = NEW.id;
END;

CREATE TABLE background_tasks_v4 (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    bookmark_id INTEGER,
    type TEXT NOT NULL CHECK(type IN ('metadata_enrichment', 'attachment_scan', 'capture', 'migration_import', 'link_check')),
    status TEXT NOT NULL CHECK(status IN ('queued', 'processing', 'retrying', 'succeeded', 'dead_letter')),
    progress INTEGER NOT NULL DEFAULT 0 CHECK(progress >= 0 AND progress <= 100),
    retry_count INTEGER NOT NULL DEFAULT 0,
    idempotency_key TEXT NOT NULL UNIQUE,
    source_url TEXT NOT NULL DEFAULT '',
    content_id TEXT,
    payload TEXT NOT NULL DEFAULT '{}',
    result_metadata TEXT NOT NULL DEFAULT '{}',
    error_code TEXT,
    error_message TEXT,
    next_retry_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    completed_at INTEGER,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (bookmark_id) REFERENCES bookmarks(id),
    FOREIGN KEY (content_id) REFERENCES content_objects(id)
);

INSERT INTO background_tasks_v4 (
    id, user_id, bookmark_id, type, status, progress, retry_count, idempotency_key,
    source_url, content_id, payload, result_metadata, error_code, error_message,
    next_retry_at, created_at, updated_at, completed_at
)
SELECT id, user_id, bookmark_id, type, status, progress, retry_count, idempotency_key,
    source_url, content_id, payload, result_metadata, error_code, error_message,
    next_retry_at, created_at, updated_at, completed_at
FROM background_tasks;

DROP TABLE background_tasks;
ALTER TABLE background_tasks_v4 RENAME TO background_tasks;

CREATE INDEX background_tasks_user_created ON background_tasks(user_id, created_at DESC);
CREATE INDEX background_tasks_bookmark ON background_tasks(bookmark_id, type, created_at DESC);
CREATE INDEX background_tasks_status_retry ON background_tasks(status, next_retry_at);
