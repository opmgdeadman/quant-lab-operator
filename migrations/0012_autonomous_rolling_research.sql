CREATE TABLE IF NOT EXISTS rolling_research_policies (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL CHECK (version >= 1),
  policy_json TEXT NOT NULL,
  policy_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rolling_research_epochs (
  id TEXT PRIMARY KEY,
  policy_id TEXT NOT NULL,
  policy_hash TEXT NOT NULL,
  epoch_date TEXT NOT NULL UNIQUE,
  as_of_closed_at TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('waiting_for_history', 'complete')),
  available_candle_count INTEGER NOT NULL CHECK (available_candle_count >= 0),
  required_candle_count INTEGER NOT NULL CHECK (required_candle_count = 720),
  dataset_hash TEXT,
  benchmark_id TEXT,
  factory_batch_id TEXT,
  selection_batch_id TEXT,
  blocker_codes_json TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  epoch_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  FOREIGN KEY (policy_id) REFERENCES rolling_research_policies(id),
  FOREIGN KEY (benchmark_id) REFERENCES baseline_benchmarks(id),
  FOREIGN KEY (factory_batch_id) REFERENCES strategy_factory_batches(id),
  FOREIGN KEY (selection_batch_id) REFERENCES selection_batches(id)
);

CREATE TABLE IF NOT EXISTS rolling_research_scheduler_receipts (
  id TEXT PRIMARY KEY,
  scheduled_at TEXT NOT NULL UNIQUE,
  epoch_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('waiting_for_history', 'complete')),
  result_hash TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (epoch_id) REFERENCES rolling_research_epochs(id)
);

CREATE INDEX IF NOT EXISTS idx_rolling_research_epochs_date
  ON rolling_research_epochs(epoch_date DESC);
CREATE INDEX IF NOT EXISTS idx_rolling_research_receipts_scheduled
  ON rolling_research_scheduler_receipts(scheduled_at DESC);

CREATE TRIGGER IF NOT EXISTS rolling_research_policies_immutable_update
BEFORE UPDATE ON rolling_research_policies BEGIN SELECT RAISE(ABORT, 'rolling_research_policies_immutable'); END;
CREATE TRIGGER IF NOT EXISTS rolling_research_policies_immutable_delete
BEFORE DELETE ON rolling_research_policies BEGIN SELECT RAISE(ABORT, 'rolling_research_policies_immutable'); END;
CREATE TRIGGER IF NOT EXISTS rolling_research_epochs_immutable_update
BEFORE UPDATE ON rolling_research_epochs BEGIN SELECT RAISE(ABORT, 'rolling_research_epochs_immutable'); END;
CREATE TRIGGER IF NOT EXISTS rolling_research_epochs_immutable_delete
BEFORE DELETE ON rolling_research_epochs BEGIN SELECT RAISE(ABORT, 'rolling_research_epochs_immutable'); END;
CREATE TRIGGER IF NOT EXISTS rolling_research_scheduler_receipts_immutable_update
BEFORE UPDATE ON rolling_research_scheduler_receipts BEGIN SELECT RAISE(ABORT, 'rolling_research_scheduler_receipts_immutable'); END;
CREATE TRIGGER IF NOT EXISTS rolling_research_scheduler_receipts_immutable_delete
BEFORE DELETE ON rolling_research_scheduler_receipts BEGIN SELECT RAISE(ABORT, 'rolling_research_scheduler_receipts_immutable'); END;
