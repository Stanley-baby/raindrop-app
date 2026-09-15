ALTER TABLE bookmarks ADD COLUMN media TEXT NOT NULL DEFAULT '[]';
ALTER TABLE collections ADD COLUMN cover TEXT NOT NULL DEFAULT '[]';

UPDATE bookmarks
SET media = CASE
    WHEN cover = '<screenshot>' THEN '[{"link":"<screenshot>","type":"image","screenshot":true}]'
    ELSE json_array(json_object('link', cover, 'type', 'image'))
END
WHERE trim(cover) <> '' AND (media IS NULL OR media = '' OR media = '[]');

DROP TRIGGER IF EXISTS bookmarks_after_update;

CREATE TRIGGER bookmarks_after_update
AFTER UPDATE OF url, title, collection_id, tags, highlights, description, note, cover, media, reminder, important, type, lang, broken, duplicate, removed_at, removed_batch, updated_at ON bookmarks
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
