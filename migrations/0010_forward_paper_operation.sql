CREATE TABLE IF NOT EXISTS forward_operation_policies (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL CHECK (version >= 1),
  policy_json TEXT NOT NULL,
  policy_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS forward_operation_cycles (
  id TEXT PRIMARY KEY,
  policy_id TEXT NOT NULL,
  policy_hash TEXT NOT NULL,
  expected_closed_at TEXT NOT NULL UNIQUE,
  scheduled_at TEXT NOT NULL,
  selection_batch_id TEXT,
  champion_candidate_id TEXT,
  market_data_status TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN (
    'blocked_no_champion',
    'blocked_data_unhealthy',
    'blocked_invalid_champion',
    'hold',
    'filled',
    'rejected',
    'error'
  )),
  blocker_codes_json TEXT NOT NULL,
  decision_id TEXT,
  paper_cycle_id TEXT,
  result_json TEXT NOT NULL,
  cycle_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  FOREIGN KEY (policy_id) REFERENCES forward_operation_policies(id)
);

CREATE TABLE IF NOT EXISTS forward_operation_decisions (
  id TEXT PRIMARY KEY,
  cycle_id TEXT NOT NULL UNIQUE,
  candidate_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('buy', 'sell', 'hold')),
  signal_closed_at TEXT NOT NULL,
  decision_at TEXT NOT NULL,
  execution_candle_closed_at TEXT NOT NULL,
  requested_notional REAL,
  requested_quantity REAL,
  reason_code TEXT NOT NULL,
  paper_cycle_id TEXT,
  paper_status TEXT,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (cycle_id) REFERENCES forward_operation_cycles(id),
  FOREIGN KEY (candidate_id) REFERENCES strategy_candidates(id)
);

CREATE TABLE IF NOT EXISTS forward_scheduler_receipts (
  id TEXT PRIMARY KEY,
  scheduled_at TEXT NOT NULL UNIQUE,
  cycle_id TEXT,
  ingestion_ok INTEGER NOT NULL CHECK (ingestion_ok IN (0, 1)),
  ingestion_error TEXT,
  forward_state TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (cycle_id) REFERENCES forward_operation_cycles(id)
);

CREATE INDEX IF NOT EXISTS idx_forward_cycles_created
  ON forward_operation_cycles(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_forward_scheduler_created
  ON forward_scheduler_receipts(created_at DESC);

CREATE TRIGGER IF NOT EXISTS forward_operation_policies_immutable_update
BEFORE UPDATE ON forward_operation_policies BEGIN SELECT RAISE(ABORT, 'forward_operation_policies_immutable'); END;
CREATE TRIGGER IF NOT EXISTS forward_operation_policies_immutable_delete
BEFORE DELETE ON forward_operation_policies BEGIN SELECT RAISE(ABORT, 'forward_operation_policies_immutable'); END;
CREATE TRIGGER IF NOT EXISTS forward_operation_cycles_immutable_update
BEFORE UPDATE ON forward_operation_cycles BEGIN SELECT RAISE(ABORT, 'forward_operation_cycles_immutable'); END;
CREATE TRIGGER IF NOT EXISTS forward_operation_cycles_immutable_delete
BEFORE DELETE ON forward_operation_cycles BEGIN SELECT RAISE(ABORT, 'forward_operation_cycles_immutable'); END;
CREATE TRIGGER IF NOT EXISTS forward_operation_decisions_immutable_update
BEFORE UPDATE ON forward_operation_decisions BEGIN SELECT RAISE(ABORT, 'forward_operation_decisions_immutable'); END;
CREATE TRIGGER IF NOT EXISTS forward_operation_decisions_immutable_delete
BEFORE DELETE ON forward_operation_decisions BEGIN SELECT RAISE(ABORT, 'forward_operation_decisions_immutable'); END;
CREATE TRIGGER IF NOT EXISTS forward_scheduler_receipts_immutable_update
BEFORE UPDATE ON forward_scheduler_receipts BEGIN SELECT RAISE(ABORT, 'forward_scheduler_receipts_immutable'); END;
CREATE TRIGGER IF NOT EXISTS forward_scheduler_receipts_immutable_delete
BEFORE DELETE ON forward_scheduler_receipts BEGIN SELECT RAISE(ABORT, 'forward_scheduler_receipts_immutable'); END;
