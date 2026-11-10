-- Per-user schedule details for the 蔡老師 (A) and other-vendor (B) order
-- reminders. Defaults reproduce the previous behavior: 10 minutes before the
-- deadline, Monday to Friday, no lunar-date restriction.
ALTER TABLE user_reminder_prefs ADD COLUMN lead_minutes INTEGER NOT NULL DEFAULT 10
  CHECK (lead_minutes IN (10, 30, 60));
-- Bit 0 = Monday ... bit 4 = Friday (31 = all weekdays).
ALTER TABLE user_reminder_prefs ADD COLUMN weekdays INTEGER NOT NULL DEFAULT 31
  CHECK (weekdays BETWEEN 1 AND 31);
-- Bit 0 = lunar day 1 (初一), bit 1 = lunar day 15 (十五); 0 = no restriction.
ALTER TABLE user_reminder_prefs ADD COLUMN lunar_days INTEGER NOT NULL DEFAULT 0
  CHECK (lunar_days BETWEEN 0 AND 3);
