CREATE TABLE IF NOT EXISTS directional_forward_policies (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL CHECK (version >= 1),
  policy_json TEXT NOT NULL,
  policy_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS directional_main_portfolios (
  id TEXT PRIMARY KEY,
  current_candidate_id TEXT,
  current_selection_id TEXT,
  initial_equity REAL NOT NULL CHECK (initial_equity > 0),
  cash_balance REAL NOT NULL,
  position_quantity REAL NOT NULL DEFAULT 0,
  average_entry REAL NOT NULL DEFAULT 0 CHECK (average_entry >= 0),
  realized_pnl REAL NOT NULL DEFAULT 0,
  unrealized_pnl REAL NOT NULL DEFAULT 0,
  total_fees REAL NOT NULL DEFAULT 0 CHECK (total_fees >= 0),
  total_carry REAL NOT NULL DEFAULT 0 CHECK (total_carry >= 0),
  equity REAL NOT NULL CHECK (equity >= 0),
  peak_equity REAL NOT NULL CHECK (peak_equity > 0),
  max_drawdown_percent REAL NOT NULL DEFAULT 0 CHECK (max_drawdown_percent >= 0),
  gross_exposure_multiple REAL NOT NULL DEFAULT 0 CHECK (gross_exposure_multiple >= 0),
  status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'liquidated')),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  last_cycle_id TEXT,
  last_mark_price REAL,
  last_marked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (current_candidate_id) REFERENCES directional_shadow_candidates(id),
  FOREIGN KEY (current_selection_id) REFERENCES directional_research_portfolio_selections(id)
);

CREATE TABLE IF NOT EXISTS directional_forward_cycles (
  id TEXT PRIMARY KEY,
  policy_id TEXT NOT NULL,
  policy_hash TEXT NOT NULL,
  expected_closed_at TEXT NOT NULL UNIQUE,
  scheduled_at TEXT NOT NULL,
  selection_id TEXT,
  research_batch_id TEXT,
  selection_state TEXT NOT NULL CHECK (selection_state IN ('portfolio_selected', 'no_qualified_candidates', 'missing')),
  champion_candidate_id TEXT,
  market_data_status TEXT NOT NULL CHECK (market_data_status IN ('healthy', 'unhealthy')),
  state TEXT NOT NULL CHECK (state IN (
    'blocked_no_champion',
    'blocked_data_unhealthy',
    'blocked_invalid_champion',
    'hold',
    'filled',
    'error'
  )),
  blocker_codes_json TEXT NOT NULL,
  decision_id TEXT,
  result_json TEXT NOT NULL,
  cycle_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  FOREIGN KEY (policy_id) REFERENCES directional_forward_policies(id),
  FOREIGN KEY (selection_id) REFERENCES directional_research_portfolio_selections(id),
  FOREIGN KEY (research_batch_id) REFERENCES directional_research_batches(id),
  FOREIGN KEY (champion_candidate_id) REFERENCES directional_shadow_candidates(id)
);

CREATE TABLE IF NOT EXISTS directional_forward_executions (
  id TEXT PRIMARY KEY,
  cycle_id TEXT NOT NULL UNIQUE,
  portfolio_id TEXT NOT NULL,
  selection_id TEXT,
  candidate_id TEXT,
  action TEXT NOT NULL CHECK (action IN ('buy', 'sell', 'hold')),
  reason_code TEXT NOT NULL,
  prior_exposure REAL NOT NULL CHECK (prior_exposure >= -1 AND prior_exposure <= 1),
  target_exposure REAL NOT NULL CHECK (target_exposure >= -1 AND target_exposure <= 1),
  signal_closed_at TEXT NOT NULL,
  execution_candle_closed_at TEXT NOT NULL,
  prior_quantity REAL NOT NULL,
  position_quantity REAL NOT NULL,
  execution_price REAL NOT NULL CHECK (execution_price > 0),
  mark_price REAL NOT NULL CHECK (mark_price > 0),
  realized_pnl_delta REAL NOT NULL,
  fee REAL NOT NULL CHECK (fee >= 0),
  carry REAL NOT NULL CHECK (carry >= 0),
  ending_equity REAL NOT NULL CHECK (ending_equity >= 0),
  max_drawdown_percent REAL NOT NULL CHECK (max_drawdown_percent >= 0),
  closed_trade INTEGER NOT NULL CHECK (closed_trade IN (0, 1)),
  result_json TEXT NOT NULL,
  execution_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  FOREIGN KEY (cycle_id) REFERENCES directional_forward_cycles(id),
  FOREIGN KEY (portfolio_id) REFERENCES directional_main_portfolios(id),
  FOREIGN KEY (selection_id) REFERENCES directional_research_portfolio_selections(id),
  FOREIGN KEY (candidate_id) REFERENCES directional_shadow_candidates(id)
);

CREATE TABLE IF NOT EXISTS directional_forward_scheduler_receipts (
  id TEXT PRIMARY KEY,
  scheduled_at TEXT NOT NULL UNIQUE,
  cycle_id TEXT,
  ingestion_ok INTEGER NOT NULL CHECK (ingestion_ok IN (0, 1)),
  ingestion_error TEXT,
  forward_state TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (cycle_id) REFERENCES directional_forward_cycles(id)
);

CREATE INDEX IF NOT EXISTS idx_directional_forward_cycles_close
  ON directional_forward_cycles(expected_closed_at DESC);
CREATE INDEX IF NOT EXISTS idx_directional_forward_executions_candidate
  ON directional_forward_executions(candidate_id, execution_candle_closed_at);
CREATE INDEX IF NOT EXISTS idx_directional_forward_scheduler_time
  ON directional_forward_scheduler_receipts(scheduled_at DESC);

CREATE TRIGGER IF NOT EXISTS directional_forward_policies_immutable_update
BEFORE UPDATE ON directional_forward_policies
BEGIN SELECT RAISE(ABORT, 'directional_forward_policy_immutable'); END;
CREATE TRIGGER IF NOT EXISTS directional_forward_policies_immutable_delete
BEFORE DELETE ON directional_forward_policies
BEGIN SELECT RAISE(ABORT, 'directional_forward_policy_immutable'); END;
CREATE TRIGGER IF NOT EXISTS directional_forward_cycles_immutable_update
BEFORE UPDATE ON directional_forward_cycles
BEGIN SELECT RAISE(ABORT, 'directional_forward_cycle_immutable'); END;
CREATE TRIGGER IF NOT EXISTS directional_forward_cycles_immutable_delete
BEFORE DELETE ON directional_forward_cycles
BEGIN SELECT RAISE(ABORT, 'directional_forward_cycle_immutable'); END;
CREATE TRIGGER IF NOT EXISTS directional_forward_executions_immutable_update
BEFORE UPDATE ON directional_forward_executions
BEGIN SELECT RAISE(ABORT, 'directional_forward_execution_immutable'); END;
CREATE TRIGGER IF NOT EXISTS directional_forward_executions_immutable_delete
BEFORE DELETE ON directional_forward_executions
BEGIN SELECT RAISE(ABORT, 'directional_forward_execution_immutable'); END;
CREATE TRIGGER IF NOT EXISTS directional_forward_scheduler_immutable_update
BEFORE UPDATE ON directional_forward_scheduler_receipts
BEGIN SELECT RAISE(ABORT, 'directional_forward_scheduler_immutable'); END;
CREATE TRIGGER IF NOT EXISTS directional_forward_scheduler_immutable_delete
BEFORE DELETE ON directional_forward_scheduler_receipts
BEGIN SELECT RAISE(ABORT, 'directional_forward_scheduler_immutable'); END;
