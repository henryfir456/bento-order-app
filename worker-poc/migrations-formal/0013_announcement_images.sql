-- Announcement image snapshots are stored as an ordered JSON array of HTTPS URLs.
-- Existing text-only announcements remain valid through the default [] value.
ALTER TABLE announcements
  ADD COLUMN image_urls_json TEXT NOT NULL DEFAULT '[]';
