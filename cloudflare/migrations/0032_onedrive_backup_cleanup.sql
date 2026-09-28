ALTER TABLE external_backup_copies ADD COLUMN remote_id TEXT;
ALTER TABLE external_backup_copies ADD COLUMN cleanup_status TEXT NOT NULL DEFAULT 'active'
    CHECK(cleanup_status IN ('active', 'pending', 'deleted', 'orphaned', 'blocked'));
ALTER TABLE external_backup_copies ADD COLUMN cleanup_attempts INTEGER NOT NULL DEFAULT 0
    CHECK(cleanup_attempts >= 0);
ALTER TABLE external_backup_copies ADD COLUMN last_cleanup_error TEXT;
ALTER TABLE external_backup_copies ADD COLUMN deleted_at INTEGER;

CREATE INDEX external_backup_cleanup ON external_backup_copies(cleanup_status, status, completed_at);
