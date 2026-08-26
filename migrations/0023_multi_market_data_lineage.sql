CREATE TABLE IF NOT EXISTS market_instruments (
  instrument_id TEXT PRIMARY KEY,
  asset_class TEXT NOT NULL CHECK (asset_class IN ('equity','etf','crypto','fx','commodity','future','rate','volatility')),
  symbol TEXT NOT NULL,
  venue TEXT NOT NULL,
  quote_currency TEXT,
  timezone TEXT NOT NULL,
  canonical_interval TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(asset_class, symbol, venue, canonical_interval)
);

CREATE TABLE IF NOT EXISTS external_data_sources (
  source_id TEXT PRIMARY KEY,
  source_class TEXT NOT NULL,
  provider TEXT NOT NULL,
  authority_type TEXT NOT NULL,
  access_state TEXT NOT NULL,
  license_class TEXT NOT NULL,
  canonical_locator TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS external_datasets (
  dataset_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES external_data_sources(source_id),
  instrument_id TEXT REFERENCES market_instruments(instrument_id),
  dataset_name TEXT NOT NULL,
  frequency TEXT NOT NULL,
  value_schema TEXT NOT NULL,
  completed_data_rule TEXT NOT NULL,
  publication_rule TEXT NOT NULL,
  revision_policy TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source_id, dataset_name, instrument_id)
);

CREATE TABLE IF NOT EXISTS external_dataset_versions (
  dataset_version_id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL REFERENCES external_datasets(dataset_id),
  observed_at TEXT NOT NULL,
  published_at TEXT NOT NULL,
  as_of TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  content_hash TEXT NOT NULL,
  access_state TEXT NOT NULL,
  license_class TEXT NOT NULL,
  source_locator TEXT NOT NULL,
  row_count INTEGER NOT NULL CHECK (row_count >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(dataset_id, as_of, revision, content_hash)
);

CREATE TABLE IF NOT EXISTS external_observations (
  observation_id TEXT PRIMARY KEY,
  dataset_version_id TEXT NOT NULL REFERENCES external_dataset_versions(dataset_version_id),
  instrument_id TEXT REFERENCES market_instruments(instrument_id),
  period_start TEXT,
  period_end TEXT NOT NULL,
  published_at TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  as_of TEXT NOT NULL,
  value_json TEXT NOT NULL,
  source_row_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(dataset_version_id, source_row_hash)
);

CREATE INDEX IF NOT EXISTS idx_external_dataset_versions_dataset_asof ON external_dataset_versions(dataset_id, as_of);
CREATE INDEX IF NOT EXISTS idx_external_observations_instrument_period ON external_observations(instrument_id, period_end);
CREATE INDEX IF NOT EXISTS idx_external_observations_published ON external_observations(published_at);
