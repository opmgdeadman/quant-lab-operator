CREATE TABLE IF NOT EXISTS strategy_factory_policies (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL CHECK (version >= 1),
  policy_json TEXT NOT NULL,
  policy_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS strategy_factory_batches (
  id TEXT PRIMARY KEY,
  policy_id TEXT NOT NULL,
  policy_hash TEXT NOT NULL,
  source_benchmark_id TEXT NOT NULL,
  source_benchmark_hash TEXT NOT NULL,
  judge_config_hash TEXT NOT NULL,
  candidate_count INTEGER NOT NULL CHECK (candidate_count >= 1),
  qualified_count INTEGER NOT NULL CHECK (qualified_count >= 0),
  insufficient_count INTEGER NOT NULL CHECK (insufficient_count >= 0),
  rejected_count INTEGER NOT NULL CHECK (rejected_count >= 0),
  summary_json TEXT NOT NULL,
  batch_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  FOREIGN KEY (policy_id) REFERENCES strategy_factory_policies(id),
  FOREIGN KEY (source_benchmark_id) REFERENCES baseline_benchmarks(id)
);

CREATE TABLE IF NOT EXISTS strategy_candidates (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  family TEXT NOT NULL CHECK (family IN ('ema_cross', 'rsi_mean_reversion')),
  parent_reference_id TEXT NOT NULL,
  spec_json TEXT NOT NULL,
  spec_hash TEXT NOT NULL UNIQUE,
  lineage_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(batch_id, id)
);

CREATE TABLE IF NOT EXISTS strategy_candidate_runs (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  partition_name TEXT NOT NULL CHECK (partition_name IN ('train', 'validation', 'test')),
  spec_hash TEXT NOT NULL,
  dataset_hash TEXT NOT NULL,
  result_hash TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  order_count INTEGER NOT NULL CHECK (order_count >= 0),
  fill_count INTEGER NOT NULL CHECK (fill_count >= 0),
  trade_count INTEGER NOT NULL CHECK (trade_count >= 0),
  created_at TEXT NOT NULL,
  UNIQUE(batch_id, candidate_id, partition_name),
  FOREIGN KEY (candidate_id) REFERENCES strategy_candidates(id)
);

CREATE TABLE IF NOT EXISTS strategy_candidate_trades (
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
  FOREIGN KEY (run_id) REFERENCES strategy_candidate_runs(id)
);

CREATE TABLE IF NOT EXISTS strategy_candidate_artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  artifact_hash TEXT NOT NULL,
  content_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(run_id),
  FOREIGN KEY (run_id) REFERENCES strategy_candidate_runs(id)
);

CREATE TABLE IF NOT EXISTS strategy_candidate_verdicts (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  judge_config_hash TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('qualified', 'insufficient_evidence', 'rejected')),
  reason_codes_json TEXT NOT NULL,
  evidence_hash TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(batch_id, candidate_id),
  FOREIGN KEY (candidate_id) REFERENCES strategy_candidates(id)
);

CREATE TABLE IF NOT EXISTS strategy_candidate_gate_results (
  id TEXT PRIMARY KEY,
  verdict_id TEXT NOT NULL,
  gate_code TEXT NOT NULL,
  passed INTEGER NOT NULL CHECK (passed IN (0, 1)),
  observed_json TEXT NOT NULL,
  threshold_json TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(verdict_id, gate_code),
  FOREIGN KEY (verdict_id) REFERENCES strategy_candidate_verdicts(id)
);

CREATE TABLE IF NOT EXISTS strategy_candidate_stress_results (
  id TEXT PRIMARY KEY,
  verdict_id TEXT NOT NULL,
  cost_multiplier INTEGER NOT NULL CHECK (cost_multiplier IN (2, 3)),
  fee_bps REAL NOT NULL CHECK (fee_bps >= 0),
  slippage_bps REAL NOT NULL CHECK (slippage_bps >= 0),
  metrics_json TEXT NOT NULL,
  result_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(verdict_id, cost_multiplier),
  FOREIGN KEY (verdict_id) REFERENCES strategy_candidate_verdicts(id)
);

CREATE INDEX IF NOT EXISTS idx_strategy_candidates_batch
  ON strategy_candidates(batch_id, family, id);
CREATE INDEX IF NOT EXISTS idx_strategy_candidate_verdicts_batch
  ON strategy_candidate_verdicts(batch_id, verdict, candidate_id);

CREATE TRIGGER IF NOT EXISTS strategy_factory_policies_immutable_update
BEFORE UPDATE ON strategy_factory_policies BEGIN SELECT RAISE(ABORT, 'strategy_factory_policies_immutable'); END;
CREATE TRIGGER IF NOT EXISTS strategy_factory_policies_immutable_delete
BEFORE DELETE ON strategy_factory_policies BEGIN SELECT RAISE(ABORT, 'strategy_factory_policies_immutable'); END;
CREATE TRIGGER IF NOT EXISTS strategy_factory_batches_immutable_update
BEFORE UPDATE ON strategy_factory_batches BEGIN SELECT RAISE(ABORT, 'strategy_factory_batches_immutable'); END;
CREATE TRIGGER IF NOT EXISTS strategy_factory_batches_immutable_delete
BEFORE DELETE ON strategy_factory_batches BEGIN SELECT RAISE(ABORT, 'strategy_factory_batches_immutable'); END;
CREATE TRIGGER IF NOT EXISTS strategy_candidates_immutable_update
BEFORE UPDATE ON strategy_candidates BEGIN SELECT RAISE(ABORT, 'strategy_candidates_immutable'); END;
CREATE TRIGGER IF NOT EXISTS strategy_candidates_immutable_delete
BEFORE DELETE ON strategy_candidates BEGIN SELECT RAISE(ABORT, 'strategy_candidates_immutable'); END;
CREATE TRIGGER IF NOT EXISTS strategy_candidate_runs_immutable_update
BEFORE UPDATE ON strategy_candidate_runs BEGIN SELECT RAISE(ABORT, 'strategy_candidate_runs_immutable'); END;
CREATE TRIGGER IF NOT EXISTS strategy_candidate_runs_immutable_delete
BEFORE DELETE ON strategy_candidate_runs BEGIN SELECT RAISE(ABORT, 'strategy_candidate_runs_immutable'); END;
CREATE TRIGGER IF NOT EXISTS strategy_candidate_trades_immutable_update
BEFORE UPDATE ON strategy_candidate_trades BEGIN SELECT RAISE(ABORT, 'strategy_candidate_trades_immutable'); END;
CREATE TRIGGER IF NOT EXISTS strategy_candidate_trades_immutable_delete
BEFORE DELETE ON strategy_candidate_trades BEGIN SELECT RAISE(ABORT, 'strategy_candidate_trades_immutable'); END;
CREATE TRIGGER IF NOT EXISTS strategy_candidate_artifacts_immutable_update
BEFORE UPDATE ON strategy_candidate_artifacts BEGIN SELECT RAISE(ABORT, 'strategy_candidate_artifacts_immutable'); END;
CREATE TRIGGER IF NOT EXISTS strategy_candidate_artifacts_immutable_delete
BEFORE DELETE ON strategy_candidate_artifacts BEGIN SELECT RAISE(ABORT, 'strategy_candidate_artifacts_immutable'); END;
CREATE TRIGGER IF NOT EXISTS strategy_candidate_verdicts_immutable_update
BEFORE UPDATE ON strategy_candidate_verdicts BEGIN SELECT RAISE(ABORT, 'strategy_candidate_verdicts_immutable'); END;
CREATE TRIGGER IF NOT EXISTS strategy_candidate_verdicts_immutable_delete
BEFORE DELETE ON strategy_candidate_verdicts BEGIN SELECT RAISE(ABORT, 'strategy_candidate_verdicts_immutable'); END;
CREATE TRIGGER IF NOT EXISTS strategy_candidate_gate_results_immutable_update
BEFORE UPDATE ON strategy_candidate_gate_results BEGIN SELECT RAISE(ABORT, 'strategy_candidate_gate_results_immutable'); END;
CREATE TRIGGER IF NOT EXISTS strategy_candidate_gate_results_immutable_delete
BEFORE DELETE ON strategy_candidate_gate_results BEGIN SELECT RAISE(ABORT, 'strategy_candidate_gate_results_immutable'); END;
CREATE TRIGGER IF NOT EXISTS strategy_candidate_stress_results_immutable_update
BEFORE UPDATE ON strategy_candidate_stress_results BEGIN SELECT RAISE(ABORT, 'strategy_candidate_stress_results_immutable'); END;
CREATE TRIGGER IF NOT EXISTS strategy_candidate_stress_results_immutable_delete
BEFORE DELETE ON strategy_candidate_stress_results BEGIN SELECT RAISE(ABORT, 'strategy_candidate_stress_results_immutable'); END;
