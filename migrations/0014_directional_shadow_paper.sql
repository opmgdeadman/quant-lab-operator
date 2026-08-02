CREATE TABLE IF NOT EXISTS directional_shadow_policies (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL CHECK (version >= 1),
  policy_json TEXT NOT NULL,
  policy_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS directional_shadow_candidates (
  id TEXT PRIMARY KEY,
  family TEXT NOT NULL CHECK (family IN (
    'ema_trend',
    'donchian_breakout',
    'price_momentum',
    'volatility_breakout',
    'rsi_mean_reversion',
    'bollinger_mean_reversion'
  )),
  spec_json TEXT NOT NULL,
  spec_hash TEXT NOT NULL,
  portfolio_id TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS directional_shadow_portfolios (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL UNIQUE,
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
  FOREIGN KEY (candidate_id) REFERENCES directional_shadow_candidates(id)
);

CREATE TABLE IF NOT EXISTS directional_shadow_cycles (
  id TEXT PRIMARY KEY,
  policy_id TEXT NOT NULL,
  policy_hash TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  signal_closed_at TEXT NOT NULL,
  execution_candle_closed_at TEXT NOT NULL UNIQUE,
  candidate_count INTEGER NOT NULL CHECK (candidate_count >= 1),
  long_count INTEGER NOT NULL CHECK (long_count >= 0),
  flat_count INTEGER NOT NULL CHECK (flat_count >= 0),
  short_count INTEGER NOT NULL CHECK (short_count >= 0),
  trade_count INTEGER NOT NULL CHECK (trade_count >= 0),
  state TEXT NOT NULL CHECK (state IN ('complete', 'blocked_data', 'error')),
  result_json TEXT NOT NULL,
  cycle_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (policy_id) REFERENCES directional_shadow_policies(id)
);

CREATE TABLE IF NOT EXISTS directional_shadow_candidate_cycles (
  id TEXT PRIMARY KEY,
  cycle_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  family TEXT NOT NULL,
  signal_closed_at TEXT NOT NULL,
  execution_candle_closed_at TEXT NOT NULL,
  prior_exposure REAL NOT NULL CHECK (prior_exposure >= -1 AND prior_exposure <= 1),
  target_exposure REAL NOT NULL CHECK (target_exposure >= -1 AND target_exposure <= 1),
  prior_quantity REAL NOT NULL,
  position_quantity REAL NOT NULL,
  average_entry REAL NOT NULL CHECK (average_entry >= 0),
  execution_price REAL NOT NULL CHECK (execution_price > 0),
  mark_price REAL NOT NULL CHECK (mark_price > 0),
  quantity_delta REAL NOT NULL,
  realized_pnl_delta REAL NOT NULL,
  fee REAL NOT NULL CHECK (fee >= 0),
  carry REAL NOT NULL CHECK (carry >= 0),
  equity REAL NOT NULL CHECK (equity >= 0),
  gross_exposure_multiple REAL NOT NULL CHECK (gross_exposure_multiple >= 0),
  max_drawdown_percent REAL NOT NULL CHECK (max_drawdown_percent >= 0),
  reason_code TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('filled', 'held', 'liquidated', 'error')),
  result_json TEXT NOT NULL,
  result_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(cycle_id, candidate_id),
  FOREIGN KEY (cycle_id) REFERENCES directional_shadow_cycles(id),
  FOREIGN KEY (candidate_id) REFERENCES directional_shadow_candidates(id)
);

CREATE TABLE IF NOT EXISTS directional_shadow_scheduler_receipts (
  id TEXT PRIMARY KEY,
  scheduled_at TEXT NOT NULL,
  cycle_id TEXT,
  state TEXT NOT NULL CHECK (state IN ('complete', 'blocked_data', 'error')),
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_directional_shadow_portfolios_equity
  ON directional_shadow_portfolios(equity DESC);
CREATE INDEX IF NOT EXISTS idx_directional_shadow_candidate_cycles_candidate
  ON directional_shadow_candidate_cycles(candidate_id, execution_candle_closed_at DESC);
CREATE INDEX IF NOT EXISTS idx_directional_shadow_cycles_created
  ON directional_shadow_cycles(execution_candle_closed_at DESC);
CREATE INDEX IF NOT EXISTS idx_directional_shadow_scheduler_created
  ON directional_shadow_scheduler_receipts(scheduled_at DESC);

CREATE TRIGGER IF NOT EXISTS directional_shadow_policies_immutable_update
BEFORE UPDATE ON directional_shadow_policies
BEGIN SELECT RAISE(ABORT, 'directional_shadow_policies_immutable'); END;
CREATE TRIGGER IF NOT EXISTS directional_shadow_policies_immutable_delete
BEFORE DELETE ON directional_shadow_policies
BEGIN SELECT RAISE(ABORT, 'directional_shadow_policies_immutable'); END;

CREATE TRIGGER IF NOT EXISTS directional_shadow_candidates_immutable_update
BEFORE UPDATE ON directional_shadow_candidates
BEGIN SELECT RAISE(ABORT, 'directional_shadow_candidates_immutable'); END;
CREATE TRIGGER IF NOT EXISTS directional_shadow_candidates_immutable_delete
BEFORE DELETE ON directional_shadow_candidates
BEGIN SELECT RAISE(ABORT, 'directional_shadow_candidates_immutable'); END;

CREATE TRIGGER IF NOT EXISTS directional_shadow_cycles_immutable_update
BEFORE UPDATE ON directional_shadow_cycles
BEGIN SELECT RAISE(ABORT, 'directional_shadow_cycles_immutable'); END;
CREATE TRIGGER IF NOT EXISTS directional_shadow_cycles_immutable_delete
BEFORE DELETE ON directional_shadow_cycles
BEGIN SELECT RAISE(ABORT, 'directional_shadow_cycles_immutable'); END;

CREATE TRIGGER IF NOT EXISTS directional_shadow_candidate_cycles_immutable_update
BEFORE UPDATE ON directional_shadow_candidate_cycles
BEGIN SELECT RAISE(ABORT, 'directional_shadow_candidate_cycles_immutable'); END;
CREATE TRIGGER IF NOT EXISTS directional_shadow_candidate_cycles_immutable_delete
BEFORE DELETE ON directional_shadow_candidate_cycles
BEGIN SELECT RAISE(ABORT, 'directional_shadow_candidate_cycles_immutable'); END;

CREATE TRIGGER IF NOT EXISTS directional_shadow_scheduler_immutable_update
BEFORE UPDATE ON directional_shadow_scheduler_receipts
BEGIN SELECT RAISE(ABORT, 'directional_shadow_scheduler_receipts_immutable'); END;
CREATE TRIGGER IF NOT EXISTS directional_shadow_scheduler_immutable_delete
BEFORE DELETE ON directional_shadow_scheduler_receipts
BEGIN SELECT RAISE(ABORT, 'directional_shadow_scheduler_receipts_immutable'); END;
