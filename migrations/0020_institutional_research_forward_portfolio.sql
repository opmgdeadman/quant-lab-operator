CREATE TABLE IF NOT EXISTS institutional_research_forward_portfolios (
  hypothesis_id TEXT PRIMARY KEY,
  testing_started_at TEXT NOT NULL,
  initial_equity REAL NOT NULL CHECK (initial_equity > 0),
  cash_balance REAL NOT NULL,
  position_quantity REAL NOT NULL,
  average_entry REAL NOT NULL CHECK (average_entry >= 0),
  realized_pnl REAL NOT NULL,
  unrealized_pnl REAL NOT NULL,
  total_fees REAL NOT NULL CHECK (total_fees >= 0),
  total_carry REAL NOT NULL CHECK (total_carry >= 0),
  equity REAL NOT NULL CHECK (equity >= 0),
  peak_equity REAL NOT NULL CHECK (peak_equity > 0),
  max_drawdown_percent REAL NOT NULL CHECK (max_drawdown_percent >= 0),
  gross_exposure_multiple REAL NOT NULL CHECK (gross_exposure_multiple >= 0),
  closed_trade_count INTEGER NOT NULL CHECK (closed_trade_count >= 0),
  version INTEGER NOT NULL CHECK (version >= 0),
  last_cycle_id TEXT,
  last_mark_price REAL,
  last_marked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (hypothesis_id) REFERENCES institutional_hypotheses(id)
);

CREATE INDEX IF NOT EXISTS idx_institutional_forward_portfolio_updated
  ON institutional_research_forward_portfolios(updated_at DESC);
