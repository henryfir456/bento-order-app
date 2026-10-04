CREATE TABLE taiwan_government_holidays (
  holiday_date TEXT PRIMARY KEY CHECK (
    length(holiday_date) = 10
    AND holiday_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  ),
  holiday_name TEXT NOT NULL DEFAULT '',
  source_year INTEGER NOT NULL,
  source_url TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);

CREATE INDEX idx_taiwan_government_holidays_year
  ON taiwan_government_holidays (source_year, holiday_date);
