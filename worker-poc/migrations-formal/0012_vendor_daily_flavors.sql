CREATE TABLE vendor_daily_flavors (
  vendor TEXT NOT NULL CHECK (vendor = '蔡老師'),
  service_date TEXT NOT NULL CHECK (
    length(service_date) = 10
    AND service_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  ),
  flavor_name TEXT NOT NULL CHECK (length(trim(flavor_name)) BETWEEN 1 AND 160),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 500),
  image_url TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_hash TEXT NOT NULL CHECK (length(source_hash) = 64),
  fetched_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (vendor, service_date)
);

CREATE INDEX idx_vendor_daily_flavors_date
  ON vendor_daily_flavors (service_date, vendor);

CREATE TABLE vendor_daily_flavor_sync_runs (
  run_id TEXT PRIMARY KEY,
  vendor TEXT NOT NULL CHECK (vendor = '蔡老師'),
  source_url TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('RUNNING', 'SUCCESS', 'FAILED')),
  stage TEXT NOT NULL,
  error_code TEXT,
  parsed_count INTEGER NOT NULL DEFAULT 0 CHECK (parsed_count >= 0),
  considered_count INTEGER NOT NULL DEFAULT 0 CHECK (considered_count >= 0),
  added_count INTEGER NOT NULL DEFAULT 0 CHECK (added_count >= 0),
  updated_count INTEGER NOT NULL DEFAULT 0 CHECK (updated_count >= 0),
  unchanged_count INTEGER NOT NULL DEFAULT 0 CHECK (unchanged_count >= 0)
);

CREATE INDEX idx_vendor_daily_flavor_sync_runs_started
  ON vendor_daily_flavor_sync_runs (started_at DESC);
