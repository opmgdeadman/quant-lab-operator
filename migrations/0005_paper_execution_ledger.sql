CREATE TABLE IF NOT EXISTS paper_portfolios (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_currency TEXT NOT NULL CHECK (base_currency = 'USD'),
  initial_cash REAL NOT NULL CHECK (initial_cash > 0),
  cash_balance REAL NOT NULL CHECK (cash_balance >= 0),
  realized_pnl REAL NOT NULL DEFAULT 0,
  total_fees REAL NOT NULL DEFAULT 0 CHECK (total_fees >= 0),
  status TEXT NOT NULL CHECK (status IN ('active', 'paused')),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  last_cycle_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS paper_orders (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL,
  cycle_id TEXT NOT NULL,
  decision_id TEXT NOT NULL,
  decision_hash TEXT NOT NULL,
  market TEXT NOT NULL CHECK (market = 'BTC-USD'),
  side TEXT NOT NULL CHECK (side IN ('buy', 'sell', 'hold')),
  status TEXT NOT NULL CHECK (status IN ('filled', 'rejected', 'held')),
  signal_closed_at TEXT NOT NULL,
  decision_at TEXT NOT NULL,
  execution_candle_closed_at TEXT,
  requested_notional REAL,
  requested_quantity REAL,
  execution_model TEXT NOT NULL,
  fee_bps REAL NOT NULL CHECK (fee_bps >= 0),
  slippage_bps REAL NOT NULL CHECK (slippage_bps >= 0),
  rejection_reason TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(portfolio_id, decision_id),
  FOREIGN KEY (portfolio_id) REFERENCES paper_portfolios(id)
);

CREATE TABLE IF NOT EXISTS paper_fills (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE,
  portfolio_id TEXT NOT NULL,
  market TEXT NOT NULL CHECK (market = 'BTC-USD'),
  side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  fill_time TEXT NOT NULL,
  source_candle_closed_at TEXT NOT NULL,
  price REAL NOT NULL CHECK (price > 0),
  quantity REAL NOT NULL CHECK (quantity > 0),
  notional REAL NOT NULL CHECK (notional > 0),
  fee REAL NOT NULL CHECK (fee >= 0),
  slippage_price_delta REAL NOT NULL CHECK (slippage_price_delta >= 0),
  created_at TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES paper_orders(id),
  FOREIGN KEY (portfolio_id) REFERENCES paper_portfolios(id)
);

CREATE TABLE IF NOT EXISTS paper_positions (
  portfolio_id TEXT NOT NULL,
  market TEXT NOT NULL CHECK (market = 'BTC-USD'),
  quantity REAL NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  average_cost REAL NOT NULL DEFAULT 0 CHECK (average_cost >= 0),
  realized_pnl REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (portfolio_id, market),
  FOREIGN KEY (portfolio_id) REFERENCES paper_portfolios(id)
);

CREATE TABLE IF NOT EXISTS paper_cash_ledger (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL,
  order_id TEXT,
  fill_id TEXT,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('initial', 'trade_notional', 'fee')),
  amount REAL NOT NULL CHECK (amount != 0),
  balance_after REAL NOT NULL CHECK (balance_after >= 0),
  created_at TEXT NOT NULL,
  FOREIGN KEY (portfolio_id) REFERENCES paper_portfolios(id),
  FOREIGN KEY (order_id) REFERENCES paper_orders(id),
  FOREIGN KEY (fill_id) REFERENCES paper_fills(id),
  UNIQUE(fill_id, entry_type)
);

CREATE TABLE IF NOT EXISTS paper_valuation_snapshots (
  id TEXT PRIMARY KEY,
  cycle_id TEXT NOT NULL UNIQUE,
  portfolio_id TEXT NOT NULL,
  market TEXT NOT NULL CHECK (market = 'BTC-USD'),
  valued_at TEXT NOT NULL,
  source_candle_closed_at TEXT NOT NULL,
  cash_balance REAL NOT NULL CHECK (cash_balance >= 0),
  position_quantity REAL NOT NULL CHECK (position_quantity >= 0),
  average_cost REAL NOT NULL CHECK (average_cost >= 0),
  mark_price REAL NOT NULL CHECK (mark_price > 0),
  market_value REAL NOT NULL CHECK (market_value >= 0),
  realized_pnl REAL NOT NULL,
  unrealized_pnl REAL NOT NULL,
  total_fees REAL NOT NULL CHECK (total_fees >= 0),
  equity REAL NOT NULL CHECK (equity >= 0),
  accounting_delta REAL NOT NULL,
  reconciled INTEGER NOT NULL CHECK (reconciled IN (0, 1)),
  portfolio_version INTEGER NOT NULL CHECK (portfolio_version >= 1),
  created_at TEXT NOT NULL,
  FOREIGN KEY (portfolio_id) REFERENCES paper_portfolios(id)
);

CREATE TABLE IF NOT EXISTS paper_cycle_receipts (
  cycle_id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL,
  decision_id TEXT NOT NULL,
  decision_hash TEXT NOT NULL,
  order_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('filled', 'rejected', 'held')),
  expected_portfolio_version INTEGER NOT NULL CHECK (expected_portfolio_version >= 0),
  committed_portfolio_version INTEGER NOT NULL CHECK (committed_portfolio_version >= 1),
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(portfolio_id, decision_id),
  FOREIGN KEY (portfolio_id) REFERENCES paper_portfolios(id),
  FOREIGN KEY (order_id) REFERENCES paper_orders(id)
);

CREATE INDEX IF NOT EXISTS idx_paper_orders_portfolio_created
  ON paper_orders(portfolio_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_paper_fills_portfolio_created
  ON paper_fills(portfolio_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_paper_cash_portfolio_created
  ON paper_cash_ledger(portfolio_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_paper_valuations_portfolio_created
  ON paper_valuation_snapshots(portfolio_id, created_at DESC);

CREATE TRIGGER IF NOT EXISTS paper_receipt_version_guard
BEFORE INSERT ON paper_cycle_receipts
WHEN COALESCE((SELECT version FROM paper_portfolios WHERE id = NEW.portfolio_id), -1)
  != NEW.committed_portfolio_version
  OR COALESCE((SELECT last_cycle_id FROM paper_portfolios WHERE id = NEW.portfolio_id), '')
  != NEW.cycle_id
BEGIN
  SELECT RAISE(ABORT, 'paper_portfolio_version_conflict');
END;

CREATE TRIGGER IF NOT EXISTS paper_orders_immutable_update
BEFORE UPDATE ON paper_orders BEGIN SELECT RAISE(ABORT, 'paper_orders_immutable'); END;
CREATE TRIGGER IF NOT EXISTS paper_orders_immutable_delete
BEFORE DELETE ON paper_orders BEGIN SELECT RAISE(ABORT, 'paper_orders_immutable'); END;
CREATE TRIGGER IF NOT EXISTS paper_fills_immutable_update
BEFORE UPDATE ON paper_fills BEGIN SELECT RAISE(ABORT, 'paper_fills_immutable'); END;
CREATE TRIGGER IF NOT EXISTS paper_fills_immutable_delete
BEFORE DELETE ON paper_fills BEGIN SELECT RAISE(ABORT, 'paper_fills_immutable'); END;
CREATE TRIGGER IF NOT EXISTS paper_cash_immutable_update
BEFORE UPDATE ON paper_cash_ledger BEGIN SELECT RAISE(ABORT, 'paper_cash_ledger_immutable'); END;
CREATE TRIGGER IF NOT EXISTS paper_cash_immutable_delete
BEFORE DELETE ON paper_cash_ledger BEGIN SELECT RAISE(ABORT, 'paper_cash_ledger_immutable'); END;
CREATE TRIGGER IF NOT EXISTS paper_valuations_immutable_update
BEFORE UPDATE ON paper_valuation_snapshots BEGIN SELECT RAISE(ABORT, 'paper_valuations_immutable'); END;
CREATE TRIGGER IF NOT EXISTS paper_valuations_immutable_delete
BEFORE DELETE ON paper_valuation_snapshots BEGIN SELECT RAISE(ABORT, 'paper_valuations_immutable'); END;
CREATE TRIGGER IF NOT EXISTS paper_receipts_immutable_update
BEFORE UPDATE ON paper_cycle_receipts BEGIN SELECT RAISE(ABORT, 'paper_cycle_receipts_immutable'); END;
CREATE TRIGGER IF NOT EXISTS paper_receipts_immutable_delete
BEFORE DELETE ON paper_cycle_receipts BEGIN SELECT RAISE(ABORT, 'paper_cycle_receipts_immutable'); END;

INSERT OR IGNORE INTO paper_portfolios (
  id, name, base_currency, initial_cash, cash_balance, realized_pnl,
  total_fees, status, version, last_cycle_id, created_at, updated_at
) VALUES (
  'paper-main', 'Primary paper portfolio', 'USD', 10000.0, 10000.0, 0.0,
  0.0, 'active', 0, NULL,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);

INSERT OR IGNORE INTO paper_positions (
  portfolio_id, market, quantity, average_cost, realized_pnl, updated_at
) VALUES (
  'paper-main', 'BTC-USD', 0.0, 0.0, 0.0,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);

INSERT OR IGNORE INTO paper_cash_ledger (
  id, portfolio_id, order_id, fill_id, entry_type, amount, balance_after, created_at
) VALUES (
  'paper-cash:paper-main:initial', 'paper-main', NULL, NULL, 'initial',
  10000.0, 10000.0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);
