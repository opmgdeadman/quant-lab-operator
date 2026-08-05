CREATE TABLE IF NOT EXISTS directional_research_policies (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL CHECK (version >= 1),
  policy_json TEXT NOT NULL,
  policy_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS directional_research_batches (
  id TEXT PRIMARY KEY,
  policy_id TEXT NOT NULL,
  as_of_closed_at TEXT NOT NULL,
  candle_start_closed_at TEXT NOT NULL,
  candle_end_closed_at TEXT NOT NULL,
  candle_count INTEGER NOT NULL CHECK (candle_count = 4320),
  candidate_count INTEGER NOT NULL CHECK (candidate_count = 12),
  window_count INTEGER NOT NULL CHECK (window_count >= 5),
  state TEXT NOT NULL CHECK (state IN ('complete', 'blocked_data', 'error')),
  batch_hash TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (policy_id) REFERENCES directional_research_policies(id)
);

CREATE TABLE IF NOT EXISTS directional_research_windows (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 1),
  train_start_closed_at TEXT NOT NULL,
  train_end_closed_at TEXT NOT NULL,
  validation_start_closed_at TEXT NOT NULL,
  validation_end_closed_at TEXT NOT NULL,
  test_start_closed_at TEXT NOT NULL,
  test_end_closed_at TEXT NOT NULL,
  window_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(batch_id, ordinal),
  FOREIGN KEY (batch_id) REFERENCES directional_research_batches(id)
);

CREATE TABLE IF NOT EXISTS directional_research_runs (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  window_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  family TEXT NOT NULL,
  test_return_percent REAL NOT NULL,
  doubled_cost_return_percent REAL NOT NULL,
  tripled_cost_return_percent REAL NOT NULL,
  test_drawdown_percent REAL NOT NULL CHECK (test_drawdown_percent >= 0),
  closed_trade_count INTEGER NOT NULL CHECK (closed_trade_count >= 0),
  fill_count INTEGER NOT NULL CHECK (fill_count >= 0),
  total_fees REAL NOT NULL CHECK (total_fees >= 0),
  total_carry REAL NOT NULL CHECK (total_carry >= 0),
  ending_equity REAL NOT NULL CHECK (ending_equity >= 0),
  execution_model TEXT NOT NULL,
  evidence_integrity_passed INTEGER NOT NULL CHECK (evidence_integrity_passed IN (0, 1)),
  run_hash TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(batch_id, window_id, candidate_id),
  FOREIGN KEY (batch_id) REFERENCES directional_research_batches(id),
  FOREIGN KEY (window_id) REFERENCES directional_research_windows(id),
  FOREIGN KEY (candidate_id) REFERENCES directional_shadow_candidates(id)
);

CREATE TABLE IF NOT EXISTS directional_research_verdicts (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('qualified', 'awaiting_forward_evidence', 'rejected')),
  reason_codes_json TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  verdict_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(batch_id, candidate_id),
  FOREIGN KEY (batch_id) REFERENCES directional_research_batches(id),
  FOREIGN KEY (candidate_id) REFERENCES directional_shadow_candidates(id)
);

CREATE TABLE IF NOT EXISTS directional_research_portfolio_selections (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('portfolio_selected', 'no_qualified_candidates')),
  champion_candidate_ids_json TEXT NOT NULL,
  challenger_candidate_ids_json TEXT NOT NULL,
  ranking_json TEXT NOT NULL,
  cash_is_valid_allocation INTEGER NOT NULL CHECK (cash_is_valid_allocation IN (0, 1)),
  selection_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (batch_id) REFERENCES directional_research_batches(id)
);

CREATE INDEX IF NOT EXISTS idx_directional_research_batches_asof
  ON directional_research_batches(as_of_closed_at DESC);
CREATE INDEX IF NOT EXISTS idx_directional_research_runs_candidate
  ON directional_research_runs(candidate_id, batch_id);
CREATE INDEX IF NOT EXISTS idx_directional_research_verdicts_batch
  ON directional_research_verdicts(batch_id, verdict);

CREATE TRIGGER IF NOT EXISTS directional_research_policies_immutable_update
BEFORE UPDATE ON directional_research_policies
BEGIN SELECT RAISE(ABORT, 'directional_research_policy_immutable'); END;
CREATE TRIGGER IF NOT EXISTS directional_research_policies_immutable_delete
BEFORE DELETE ON directional_research_policies
BEGIN SELECT RAISE(ABORT, 'directional_research_policy_immutable'); END;
CREATE TRIGGER IF NOT EXISTS directional_research_batches_immutable_update
BEFORE UPDATE ON directional_research_batches
BEGIN SELECT RAISE(ABORT, 'directional_research_batch_immutable'); END;
CREATE TRIGGER IF NOT EXISTS directional_research_batches_immutable_delete
BEFORE DELETE ON directional_research_batches
BEGIN SELECT RAISE(ABORT, 'directional_research_batch_immutable'); END;
CREATE TRIGGER IF NOT EXISTS directional_research_windows_immutable_update
BEFORE UPDATE ON directional_research_windows
BEGIN SELECT RAISE(ABORT, 'directional_research_window_immutable'); END;
CREATE TRIGGER IF NOT EXISTS directional_research_runs_immutable_update
BEFORE UPDATE ON directional_research_runs
BEGIN SELECT RAISE(ABORT, 'directional_research_run_immutable'); END;
CREATE TRIGGER IF NOT EXISTS directional_research_verdicts_immutable_update
BEFORE UPDATE ON directional_research_verdicts
BEGIN SELECT RAISE(ABORT, 'directional_research_verdict_immutable'); END;
CREATE TRIGGER IF NOT EXISTS directional_research_portfolio_immutable_update
BEFORE UPDATE ON directional_research_portfolio_selections
BEGIN SELECT RAISE(ABORT, 'directional_research_portfolio_immutable'); END;
