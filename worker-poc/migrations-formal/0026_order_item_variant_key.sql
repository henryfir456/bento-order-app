PRAGMA foreign_keys = ON;

-- An order placed before its date is opened has no persisted menu item for a
-- variant that only exists as a menu change (e.g. 半飯), so order_items.menu_item_id
-- is NULL and the legacy code alone (H2) cannot tell BASE from HALF. The Worker
-- now stores the chosen variant on such lines; older rows stay NULL.
ALTER TABLE order_items ADD COLUMN variant_key TEXT;
