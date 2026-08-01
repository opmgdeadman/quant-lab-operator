CREATE TABLE IF NOT EXISTS hostile_judge_configs (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL CHECK (version >= 1),
  config_json TEXT NOT NULL,
  config_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hostile_judge_batches (
  id TEXT PRIMARY KEY,
  benchmark_id TEXT NOT NULL,
  benchmark_hash TEXT NOT NULL,
  judge_config_id TEXT NOT NULL,
  judge_config_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status = 'complete'),
  evaluation_count INTEGER NOT NULL CHECK (evaluation_count >= 1),
  qualified_count INTEGER NOT NULL CHECK (qualified_count >= 0),
  insufficient_count INTEGER NOT NULL CHECK (insufficient_count >= 0),
  rejected_count INTEGER NOT NULL CHECK (rejected_count >= 0),
  summary_json TEXT NOT NULL,
  batch_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  FOREIGN KEY (judge_config_id) REFERENCES hostile_judge_configs(id),
  FOREIGN KEY (benchmark_id) REFERENCES baseline_benchmarks(id)
);

CREATE TABLE IF NOT EXISTS hostile_judge_evaluations (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  baseline_id TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('qualified', 'insufficient_evidence', 'rejected')),
  reason_codes_json TEXT NOT NULL,
  evidence_hash TEXT NOT NULL,
  train_result_hash TEXT NOT NULL,
  validation_result_hash TEXT NOT NULL,
  test_result_hash TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(batch_id, baseline_id),
  FOREIGN KEY (batch_id) REFERENCES hostile_judge_batches(id),
  FOREIGN KEY (baseline_id) REFERENCES baseline_definitions(id)
);

CREATE TABLE IF NOT EXISTS hostile_judge_gate_results (
  id TEXT PRIMARY KEY,
  evaluation_id TEXT NOT NULL,
  gate_code TEXT NOT NULL,
  passed INTEGER NOT NULL CHECK (passed IN (0, 1)),
  observed_json TEXT NOT NULL,
  threshold_json TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(evaluation_id, gate_code),
  FOREIGN KEY (evaluation_id) REFERENCES hostile_judge_evaluations(id)
);

CREATE TABLE IF NOT EXISTS hostile_judge_stress_results (
  id TEXT PRIMARY KEY,
  evaluation_id TEXT NOT NULL,
  cost_multiplier INTEGER NOT NULL CHECK (cost_multiplier IN (2, 3)),
  fee_bps REAL NOT NULL CHECK (fee_bps >= 0),
  slippage_bps REAL NOT NULL CHECK (slippage_bps >= 0),
  metrics_json TEXT NOT NULL,
  result_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(evaluation_id, cost_multiplier),
  FOREIGN KEY (evaluation_id) REFERENCES hostile_judge_evaluations(id)
);

CREATE INDEX IF NOT EXISTS idx_hostile_judge_batch_verdict
  ON hostile_judge_evaluations(batch_id, verdict, baseline_id);
CREATE INDEX IF NOT EXISTS idx_hostile_judge_gates_evaluation
  ON hostile_judge_gate_results(evaluation_id, gate_code);

CREATE TRIGGER IF NOT EXISTS hostile_judge_configs_immutable_update
BEFORE UPDATE ON hostile_judge_configs BEGIN SELECT RAISE(ABORT, 'hostile_judge_configs_immutable'); END;
CREATE TRIGGER IF NOT EXISTS hostile_judge_configs_immutable_delete
BEFORE DELETE ON hostile_judge_configs BEGIN SELECT RAISE(ABORT, 'hostile_judge_configs_immutable'); END;
CREATE TRIGGER IF NOT EXISTS hostile_judge_batches_immutable_update
BEFORE UPDATE ON hostile_judge_batches BEGIN SELECT RAISE(ABORT, 'hostile_judge_batches_immutable'); END;
CREATE TRIGGER IF NOT EXISTS hostile_judge_batches_immutable_delete
BEFORE DELETE ON hostile_judge_batches BEGIN SELECT RAISE(ABORT, 'hostile_judge_batches_immutable'); END;
CREATE TRIGGER IF NOT EXISTS hostile_judge_evaluations_immutable_update
BEFORE UPDATE ON hostile_judge_evaluations BEGIN SELECT RAISE(ABORT, 'hostile_judge_evaluations_immutable'); END;
CREATE TRIGGER IF NOT EXISTS hostile_judge_evaluations_immutable_delete
BEFORE DELETE ON hostile_judge_evaluations BEGIN SELECT RAISE(ABORT, 'hostile_judge_evaluations_immutable'); END;
CREATE TRIGGER IF NOT EXISTS hostile_judge_gate_results_immutable_update
BEFORE UPDATE ON hostile_judge_gate_results BEGIN SELECT RAISE(ABORT, 'hostile_judge_gate_results_immutable'); END;
CREATE TRIGGER IF NOT EXISTS hostile_judge_gate_results_immutable_delete
BEFORE DELETE ON hostile_judge_gate_results BEGIN SELECT RAISE(ABORT, 'hostile_judge_gate_results_immutable'); END;
CREATE TRIGGER IF NOT EXISTS hostile_judge_stress_results_immutable_update
BEFORE UPDATE ON hostile_judge_stress_results BEGIN SELECT RAISE(ABORT, 'hostile_judge_stress_results_immutable'); END;
CREATE TRIGGER IF NOT EXISTS hostile_judge_stress_results_immutable_delete
BEFORE DELETE ON hostile_judge_stress_results BEGIN SELECT RAISE(ABORT, 'hostile_judge_stress_results_immutable'); END;
