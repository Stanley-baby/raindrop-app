ALTER TABLE bookmarks ADD COLUMN reminder TEXT NOT NULL DEFAULT '{}';
ALTER TABLE bookmarks ADD COLUMN lang TEXT NOT NULL DEFAULT '';
ALTER TABLE bookmarks ADD COLUMN broken INTEGER NOT NULL DEFAULT 0 CHECK(broken IN (0, 1));
ALTER TABLE bookmarks ADD COLUMN duplicate INTEGER;
ALTER TABLE collections ADD COLUMN expanded INTEGER NOT NULL DEFAULT 0 CHECK(expanded IN (0, 1));
ALTER TABLE collections ADD COLUMN sort REAL NOT NULL DEFAULT 0;

DROP TRIGGER IF EXISTS bookmarks_after_update;

CREATE TRIGGER bookmarks_after_update
AFTER UPDATE OF url, title, collection_id, tags, highlights, description, note, cover, reminder, important, type, lang, broken, duplicate, removed_at, removed_batch, updated_at ON bookmarks
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
