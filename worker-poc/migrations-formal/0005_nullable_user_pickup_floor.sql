-- Canonical identity may exist before the operational pickup-floor profile is
-- complete. Keep the operational domain strict for non-null values and do not
-- introduce a sentinel floor.
--
-- This is intentionally a column-level change. Rebuilding or dropping users
-- would violate the existing child foreign keys in D1's enforced migration
-- transaction.
ALTER TABLE users
  RENAME COLUMN pickup_floor TO pickup_floor_legacy;

ALTER TABLE users
  ADD COLUMN pickup_floor TEXT
    CHECK (pickup_floor IS NULL OR pickup_floor IN ('1樓', '9樓'));

UPDATE users
SET pickup_floor = pickup_floor_legacy;

ALTER TABLE users
  DROP COLUMN pickup_floor_legacy;
