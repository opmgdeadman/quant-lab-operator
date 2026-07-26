ALTER TABLE operator_operation_receipts ADD COLUMN intent TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE operator_operation_receipts ADD COLUMN status TEXT NOT NULL DEFAULT 'completed';

CREATE TABLE IF NOT EXISTS operator_continuation_state (
  id TEXT PRIMARY KEY,
  active_objective TEXT,
  current_phase TEXT,
  completed_evidence_json TEXT NOT NULL DEFAULT '[]',
  next_action TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS operator_audit_log (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL,
  intent TEXT NOT NULL,
  status TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS operator_incidents (
  id TEXT PRIMARY KEY,
  operation_id TEXT,
  severity TEXT NOT NULL CHECK (severity IN ('P0', 'P1', 'P2', 'P3')),
  status TEXT NOT NULL CHECK (status IN ('open', 'contained', 'repaired', 'validated', 'closed')),
  summary TEXT NOT NULL,
  root_cause TEXT,
  next_action TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
