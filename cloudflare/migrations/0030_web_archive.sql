CREATE TABLE web_archives (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    bookmark_id INTEGER NOT NULL UNIQUE,
    policy TEXT NOT NULL DEFAULT 'on_save' CHECK(policy IN ('off', 'manual', 'on_save', 'on_save_refresh')),
    status TEXT NOT NULL DEFAULT 'not_requested' CHECK(status IN ('not_requested', 'queued', 'capturing', 'packaging', 'scanning', 'ready', 'stale', 'failed', 'blocked', 'deleted')),
    current_version_id TEXT,
    source_url TEXT NOT NULL DEFAULT '',
    final_url TEXT NOT NULL DEFAULT '',
    last_error_code TEXT,
    last_error_message TEXT,
    next_capture_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (bookmark_id) REFERENCES bookmarks(id)
);

CREATE INDEX web_archives_user_status ON web_archives(user_id, status, updated_at DESC);
CREATE INDEX web_archives_refresh ON web_archives(status, next_capture_at);

CREATE TABLE web_archive_versions (
    id TEXT PRIMARY KEY,
    archive_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    bookmark_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued', 'capturing', 'packaging', 'scanning', 'ready', 'failed', 'superseded', 'deleted')),
    root_content_id TEXT,
    source_url TEXT NOT NULL,
    final_url TEXT NOT NULL DEFAULT '',
    capture_mode TEXT NOT NULL DEFAULT 'rendered' CHECK(capture_mode IN ('rendered', 'static', 'binary')),
    content_hash TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    text_bytes INTEGER NOT NULL DEFAULT 0,
    asset_count INTEGER NOT NULL DEFAULT 0,
    total_bytes INTEGER NOT NULL DEFAULT 0,
    captured_at INTEGER,
    expires_at INTEGER,
    failure_code TEXT,
    failure_message TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (archive_id) REFERENCES web_archives(id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (bookmark_id) REFERENCES bookmarks(id),
    FOREIGN KEY (root_content_id) REFERENCES content_objects(id)
);

CREATE INDEX web_archive_versions_bookmark ON web_archive_versions(bookmark_id, created_at DESC);
CREATE INDEX web_archive_versions_status ON web_archive_versions(status, updated_at);

CREATE TABLE web_archive_assets (
    id TEXT PRIMARY KEY,
    version_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    bookmark_id INTEGER NOT NULL,
    content_id TEXT,
    original_url TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    size_bytes INTEGER NOT NULL DEFAULT 0,
    content_hash TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'ready' CHECK(status IN ('ready', 'failed', 'skipped')),
    created_at INTEGER NOT NULL,
    FOREIGN KEY (version_id) REFERENCES web_archive_versions(id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (bookmark_id) REFERENCES bookmarks(id),
    FOREIGN KEY (content_id) REFERENCES content_objects(id)
);

CREATE UNIQUE INDEX web_archive_assets_version_url ON web_archive_assets(version_id, original_url);
CREATE INDEX web_archive_assets_version ON web_archive_assets(version_id, status);

CREATE TABLE web_archive_search_documents (
    version_id TEXT PRIMARY KEY,
    bookmark_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    captured_at INTEGER NOT NULL,
    FOREIGN KEY (version_id) REFERENCES web_archive_versions(id),
    FOREIGN KEY (bookmark_id) REFERENCES bookmarks(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX web_archive_search_documents_bookmark ON web_archive_search_documents(bookmark_id, captured_at DESC);

CREATE VIRTUAL TABLE web_archive_fts USING fts5(
    version_id UNINDEXED,
    bookmark_id UNINDEXED,
    title,
    body
);

CREATE TABLE web_archive_usage (
    user_id INTEGER PRIMARY KEY,
    used_bytes INTEGER NOT NULL DEFAULT 0,
    reserved_bytes INTEGER NOT NULL DEFAULT 0,
    object_count INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE background_tasks_v6 (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    bookmark_id INTEGER,
    type TEXT NOT NULL CHECK(type IN ('metadata_enrichment', 'attachment_scan', 'capture', 'archive_capture', 'migration_import', 'link_check', 'duplicate_scan')),
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

INSERT INTO background_tasks_v6 (
    id, user_id, bookmark_id, type, status, progress, retry_count, idempotency_key,
    source_url, content_id, payload, result_metadata, error_code, error_message,
    next_retry_at, created_at, updated_at, completed_at
)
SELECT id, user_id, bookmark_id, type, status, progress, retry_count, idempotency_key,
    source_url, content_id, payload, result_metadata, error_code, error_message,
    next_retry_at, created_at, updated_at, completed_at
FROM background_tasks;

DROP TABLE background_tasks;
ALTER TABLE background_tasks_v6 RENAME TO background_tasks;

CREATE INDEX background_tasks_user_created ON background_tasks(user_id, created_at DESC);
CREATE INDEX background_tasks_bookmark ON background_tasks(bookmark_id, type, created_at DESC);
CREATE INDEX background_tasks_status_retry ON background_tasks(status, next_retry_at);
