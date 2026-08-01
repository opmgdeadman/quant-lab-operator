CREATE TABLE IF NOT EXISTS baseline_definitions (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL CHECK (version >= 1),
  kind TEXT NOT NULL CHECK (kind IN ('buy_hold', 'ema_cross', 'rsi_mean_reversion')),
  spec_json TEXT NOT NULL,
  spec_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS baseline_benchmarks (
  id TEXT PRIMARY KEY,
  market TEXT NOT NULL CHECK (market = 'BTC-USD'),
  interval TEXT NOT NULL CHECK (interval = '1h'),
  dataset_start_closed_at TEXT NOT NULL,
  dataset_end_closed_at TEXT NOT NULL,
  dataset_candle_count INTEGER NOT NULL CHECK (dataset_candle_count >= 60),
  dataset_hash TEXT NOT NULL,
  partition_manifest_json TEXT NOT NULL,
  cost_model_json TEXT NOT NULL,
  benchmark_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status = 'complete'),
  summary_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS baseline_runs (
  id TEXT PRIMARY KEY,
  benchmark_id TEXT NOT NULL,
  baseline_id TEXT NOT NULL,
  partition_name TEXT NOT NULL CHECK (partition_name IN ('train', 'validation', 'test')),
  spec_hash TEXT NOT NULL,
  dataset_hash TEXT NOT NULL,
  result_hash TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  order_count INTEGER NOT NULL CHECK (order_count >= 0),
  fill_count INTEGER NOT NULL CHECK (fill_count >= 0),
  trade_count INTEGER NOT NULL CHECK (trade_count >= 0),
  created_at TEXT NOT NULL,
  UNIQUE(benchmark_id, baseline_id, partition_name),
  FOREIGN KEY (benchmark_id) REFERENCES baseline_benchmarks(id),
  FOREIGN KEY (baseline_id) REFERENCES baseline_definitions(id)
);

CREATE TABLE IF NOT EXISTS baseline_trades (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  entry_fill_id TEXT NOT NULL,
  exit_fill_id TEXT NOT NULL,
  entry_time TEXT NOT NULL,
  exit_time TEXT NOT NULL,
  quantity REAL NOT NULL CHECK (quantity > 0),
  entry_price REAL NOT NULL CHECK (entry_price > 0),
  exit_price REAL NOT NULL CHECK (exit_price > 0),
  gross_pnl REAL NOT NULL,
  net_pnl REAL NOT NULL,
  net_pnl_percent REAL NOT NULL,
  total_fees REAL NOT NULL CHECK (total_fees >= 0),
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES baseline_runs(id)
);

CREATE TABLE IF NOT EXISTS baseline_artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  artifact_type TEXT NOT NULL CHECK (artifact_type = 'deterministic_result_v1'),
  artifact_hash TEXT NOT NULL,
  content_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(run_id, artifact_type),
  FOREIGN KEY (run_id) REFERENCES baseline_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_baseline_runs_benchmark_partition
  ON baseline_runs(benchmark_id, partition_name, baseline_id);
CREATE INDEX IF NOT EXISTS idx_baseline_trades_run
  ON baseline_trades(run_id, entry_time);

CREATE TRIGGER IF NOT EXISTS baseline_definitions_immutable_update
BEFORE UPDATE ON baseline_definitions BEGIN SELECT RAISE(ABORT, 'baseline_definitions_immutable'); END;
CREATE TRIGGER IF NOT EXISTS baseline_definitions_immutable_delete
BEFORE DELETE ON baseline_definitions BEGIN SELECT RAISE(ABORT, 'baseline_definitions_immutable'); END;
CREATE TRIGGER IF NOT EXISTS baseline_benchmarks_immutable_update
BEFORE UPDATE ON baseline_benchmarks BEGIN SELECT RAISE(ABORT, 'baseline_benchmarks_immutable'); END;
CREATE TRIGGER IF NOT EXISTS baseline_benchmarks_immutable_delete
BEFORE DELETE ON baseline_benchmarks BEGIN SELECT RAISE(ABORT, 'baseline_benchmarks_immutable'); END;
CREATE TRIGGER IF NOT EXISTS baseline_runs_immutable_update
BEFORE UPDATE ON baseline_runs BEGIN SELECT RAISE(ABORT, 'baseline_runs_immutable'); END;
CREATE TRIGGER IF NOT EXISTS baseline_runs_immutable_delete
BEFORE DELETE ON baseline_runs BEGIN SELECT RAISE(ABORT, 'baseline_runs_immutable'); END;
CREATE TRIGGER IF NOT EXISTS baseline_trades_immutable_update
BEFORE UPDATE ON baseline_trades BEGIN SELECT RAISE(ABORT, 'baseline_trades_immutable'); END;
CREATE TRIGGER IF NOT EXISTS baseline_trades_immutable_delete
BEFORE DELETE ON baseline_trades BEGIN SELECT RAISE(ABORT, 'baseline_trades_immutable'); END;
CREATE TRIGGER IF NOT EXISTS baseline_artifacts_immutable_update
BEFORE UPDATE ON baseline_artifacts BEGIN SELECT RAISE(ABORT, 'baseline_artifacts_immutable'); END;
CREATE TRIGGER IF NOT EXISTS baseline_artifacts_immutable_delete
BEFORE DELETE ON baseline_artifacts BEGIN SELECT RAISE(ABORT, 'baseline_artifacts_immutable'); END;
