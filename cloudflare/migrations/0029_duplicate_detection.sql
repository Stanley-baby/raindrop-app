-- V1.5 duplicate detection: URL index, review groups, and reversible merge records.
CREATE TABLE bookmark_url_keys (
    bookmark_id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    canonical_version INTEGER NOT NULL DEFAULT 1,
    exact_hash TEXT NOT NULL,
    normalized_hash TEXT NOT NULL,
    host_alias_hash TEXT,
    final_hash TEXT,
    exact_url TEXT NOT NULL,
    normalized_url TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (bookmark_id) REFERENCES bookmarks(id) ON DELETE CASCADE
);

CREATE INDEX bookmark_url_keys_user_exact ON bookmark_url_keys(user_id, exact_hash);
CREATE INDEX bookmark_url_keys_user_normalized ON bookmark_url_keys(user_id, normalized_hash);
CREATE INDEX bookmark_url_keys_user_host_alias ON bookmark_url_keys(user_id, host_alias_hash);
CREATE INDEX bookmark_url_keys_user_final ON bookmark_url_keys(user_id, final_hash);

CREATE TABLE duplicate_scan_runs (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    scope_collection_id INTEGER NOT NULL DEFAULT 0,
    mode TEXT NOT NULL CHECK(mode IN ('safe', 'all')),
    phase TEXT NOT NULL CHECK(phase IN ('index', 'group', 'complete')),
    status TEXT NOT NULL CHECK(status IN ('queued', 'processing', 'succeeded', 'failed')),
    task_id TEXT,
    cursor_id INTEGER NOT NULL DEFAULT 0,
    groups_found INTEGER NOT NULL DEFAULT 0,
    candidates_found INTEGER NOT NULL DEFAULT 0,
    error_code TEXT,
    error_message TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    completed_at INTEGER,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX duplicate_scan_runs_user_status ON duplicate_scan_runs(user_id, status, created_at DESC);

CREATE TABLE duplicate_groups (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    scope_collection_id INTEGER NOT NULL DEFAULT 0,
    kind TEXT NOT NULL CHECK(kind IN ('exact', 'tracking', 'path', 'host_alias', 'redirect', 'legacy')),
    confidence INTEGER NOT NULL CHECK(confidence >= 0 AND confidence <= 100),
    key_hash TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    representative_id INTEGER,
    status TEXT NOT NULL CHECK(status IN ('open', 'dismissed', 'merged', 'stale')),
    scan_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    resolved_at INTEGER,
    resolved_by INTEGER,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (representative_id) REFERENCES bookmarks(id),
    FOREIGN KEY (scan_id) REFERENCES duplicate_scan_runs(id)
);

CREATE UNIQUE INDEX duplicate_groups_key ON duplicate_groups(user_id, scope_collection_id, kind, key_hash);
CREATE INDEX duplicate_groups_user_status ON duplicate_groups(user_id, status, updated_at DESC);
CREATE INDEX duplicate_groups_scope ON duplicate_groups(user_id, scope_collection_id, status);

CREATE TABLE duplicate_group_items (
    group_id TEXT NOT NULL,
    bookmark_id INTEGER NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('representative', 'candidate')),
    evidence_json TEXT NOT NULL DEFAULT '{}',
    url_at_scan TEXT NOT NULL,
    change_version_at_scan INTEGER NOT NULL,
    PRIMARY KEY(group_id, bookmark_id),
    FOREIGN KEY (group_id) REFERENCES duplicate_groups(id) ON DELETE CASCADE,
    FOREIGN KEY (bookmark_id) REFERENCES bookmarks(id) ON DELETE CASCADE
);

CREATE INDEX duplicate_group_items_bookmark ON duplicate_group_items(bookmark_id);

CREATE TABLE duplicate_merge_operations (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    group_id TEXT NOT NULL,
    survivor_id INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('processing', 'succeeded', 'undone', 'failed')),
    created_at INTEGER NOT NULL,
    completed_at INTEGER,
    error_code TEXT,
    error_message TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (group_id) REFERENCES duplicate_groups(id),
    FOREIGN KEY (survivor_id) REFERENCES bookmarks(id)
);

CREATE TABLE duplicate_merge_items (
    operation_id TEXT NOT NULL,
    bookmark_id INTEGER NOT NULL,
    was_survivor INTEGER NOT NULL DEFAULT 0,
    previous_json TEXT NOT NULL,
    PRIMARY KEY(operation_id, bookmark_id),
    FOREIGN KEY (operation_id) REFERENCES duplicate_merge_operations(id),
    FOREIGN KEY (bookmark_id) REFERENCES bookmarks(id)
);

-- SQLite cannot alter the CHECK constraint in place, so rebuild the task table
-- while preserving all existing task rows and indexes.
CREATE TABLE background_tasks_v5 (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    bookmark_id INTEGER,
    type TEXT NOT NULL CHECK(type IN ('metadata_enrichment', 'attachment_scan', 'capture', 'migration_import', 'link_check', 'duplicate_scan')),
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

INSERT INTO background_tasks_v5 (
    id, user_id, bookmark_id, type, status, progress, retry_count, idempotency_key,
    source_url, content_id, payload, result_metadata, error_code, error_message,
    next_retry_at, created_at, updated_at, completed_at
)
SELECT id, user_id, bookmark_id, type, status, progress, retry_count, idempotency_key,
    source_url, content_id, payload, result_metadata, error_code, error_message,
    next_retry_at, created_at, updated_at, completed_at
FROM background_tasks;

DROP TABLE background_tasks;
ALTER TABLE background_tasks_v5 RENAME TO background_tasks;

CREATE INDEX background_tasks_user_created ON background_tasks(user_id, created_at DESC);
CREATE INDEX background_tasks_bookmark ON background_tasks(bookmark_id, type, created_at DESC);
CREATE INDEX background_tasks_status_retry ON background_tasks(status, next_retry_at);
