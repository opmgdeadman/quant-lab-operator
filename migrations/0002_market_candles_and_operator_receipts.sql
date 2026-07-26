CREATE TABLE IF NOT EXISTS market_candles (
  id TEXT PRIMARY KEY,
  pair TEXT NOT NULL,
  interval TEXT NOT NULL,
  closed_at TEXT NOT NULL,
  open REAL NOT NULL,
  high REAL NOT NULL,
  low REAL NOT NULL,
  close REAL NOT NULL,
  volume REAL NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(pair, interval, closed_at)
);

CREATE TABLE IF NOT EXISTS operator_operation_receipts (
  operation_id TEXT PRIMARY KEY,
  tool_name TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
