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

-- Seed 2026 weekday holidays from the DGPA 115-year government office calendar.
-- Annual sync replaces the year's rows when the official CSV is available.
INSERT INTO taiwan_government_holidays (
  holiday_date, holiday_name, source_year, source_url, fetched_at
) VALUES
  ('2026-01-01', '開國紀念日', 2026, 'https://data.gov.tw/dataset/14718', CURRENT_TIMESTAMP),
  ('2026-02-16', '春節連假', 2026, 'https://data.gov.tw/dataset/14718', CURRENT_TIMESTAMP),
  ('2026-02-17', '春節', 2026, 'https://data.gov.tw/dataset/14718', CURRENT_TIMESTAMP),
  ('2026-02-18', '春節', 2026, 'https://data.gov.tw/dataset/14718', CURRENT_TIMESTAMP),
  ('2026-02-19', '春節', 2026, 'https://data.gov.tw/dataset/14718', CURRENT_TIMESTAMP),
  ('2026-02-20', '春節補假', 2026, 'https://data.gov.tw/dataset/14718', CURRENT_TIMESTAMP),
  ('2026-02-27', '和平紀念日補假', 2026, 'https://data.gov.tw/dataset/14718', CURRENT_TIMESTAMP),
  ('2026-04-03', '兒童節補假', 2026, 'https://data.gov.tw/dataset/14718', CURRENT_TIMESTAMP),
  ('2026-04-06', '清明節補假', 2026, 'https://data.gov.tw/dataset/14718', CURRENT_TIMESTAMP),
  ('2026-05-01', '勞動節', 2026, 'https://data.gov.tw/dataset/14718', CURRENT_TIMESTAMP),
  ('2026-06-19', '端午節', 2026, 'https://data.gov.tw/dataset/14718', CURRENT_TIMESTAMP),
  ('2026-09-25', '中秋節', 2026, 'https://data.gov.tw/dataset/14718', CURRENT_TIMESTAMP),
  ('2026-09-28', '教師節', 2026, 'https://data.gov.tw/dataset/14718', CURRENT_TIMESTAMP),
  ('2026-10-09', '國慶日補假', 2026, 'https://data.gov.tw/dataset/14718', CURRENT_TIMESTAMP),
  ('2026-10-26', '臺灣光復暨金門古寧頭大捷紀念日補假', 2026, 'https://data.gov.tw/dataset/14718', CURRENT_TIMESTAMP),
  ('2026-12-25', '行憲紀念日', 2026, 'https://data.gov.tw/dataset/14718', CURRENT_TIMESTAMP);
