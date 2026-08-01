CREATE TABLE IF NOT EXISTS market_data_health (
  id TEXT PRIMARY KEY,
  pair TEXT NOT NULL,
  interval TEXT NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL,
  latest_closed_at TEXT,
  expected_latest_closed_at TEXT NOT NULL,
  stale_hours INTEGER,
  missing_candles INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,
  last_success_at TEXT,
  last_error TEXT,
  fetched_count INTEGER NOT NULL DEFAULT 0,
  inserted_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS market_data_ingestion_runs (
  id TEXT PRIMARY KEY,
  pair TEXT NOT NULL,
  interval TEXT NOT NULL,
  provider TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  status TEXT NOT NULL,
  requested_start_closed_at TEXT NOT NULL,
  requested_end_closed_at TEXT NOT NULL,
  fetched_count INTEGER NOT NULL DEFAULT 0,
  inserted_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  missing_candles INTEGER NOT NULL DEFAULT 0,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_market_data_ingestion_runs_completed_at
  ON market_data_ingestion_runs(completed_at DESC);
