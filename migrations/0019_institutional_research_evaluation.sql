CREATE TABLE IF NOT EXISTS institutional_research_evaluations (
  id TEXT PRIMARY KEY,
  hypothesis_id TEXT NOT NULL UNIQUE,
  preregistration_hash TEXT NOT NULL,
  as_of_closed_at TEXT NOT NULL,
  candle_start_closed_at TEXT NOT NULL,
  candle_end_closed_at TEXT NOT NULL,
  artifact_json TEXT NOT NULL,
  artifact_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  FOREIGN KEY (hypothesis_id) REFERENCES institutional_hypotheses(id)
);

CREATE TABLE IF NOT EXISTS institutional_research_forward_evidence (
  id TEXT PRIMARY KEY,
  hypothesis_id TEXT NOT NULL,
  cycle_id TEXT NOT NULL UNIQUE,
  expected_closed_at TEXT NOT NULL,
  target_exposure REAL NOT NULL CHECK (target_exposure >= -1 AND target_exposure <= 1),
  status TEXT NOT NULL CHECK (status IN ('held', 'filled', 'flat', 'blocked', 'error')),
  equity REAL NOT NULL CHECK (equity >= 0),
  return_percent REAL NOT NULL,
  max_drawdown_percent REAL NOT NULL CHECK (max_drawdown_percent >= 0),
  closed_trade_count INTEGER NOT NULL CHECK (closed_trade_count >= 0),
  evidence_integrity_passed INTEGER NOT NULL CHECK (evidence_integrity_passed IN (0, 1)),
  evidence_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  FOREIGN KEY (hypothesis_id) REFERENCES institutional_hypotheses(id)
);

CREATE TABLE IF NOT EXISTS institutional_research_verdicts (
  id TEXT PRIMARY KEY,
  hypothesis_id TEXT NOT NULL,
  evaluation_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence >= 1),
  forward_evidence_count INTEGER NOT NULL CHECK (forward_evidence_count >= 0),
  evidence_hash TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('rejected', 'awaiting_forward_evidence', 'qualified')),
  reason_codes_json TEXT NOT NULL,
  verdict_json TEXT NOT NULL,
  verdict_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  UNIQUE(hypothesis_id, sequence),
  UNIQUE(hypothesis_id, evidence_hash),
  FOREIGN KEY (hypothesis_id) REFERENCES institutional_hypotheses(id),
  FOREIGN KEY (evaluation_id) REFERENCES institutional_research_evaluations(id)
);

CREATE INDEX IF NOT EXISTS idx_institutional_evaluation_created
  ON institutional_research_evaluations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_institutional_forward_hypothesis_time
  ON institutional_research_forward_evidence(hypothesis_id, expected_closed_at ASC, cycle_id ASC);
CREATE INDEX IF NOT EXISTS idx_institutional_verdict_latest
  ON institutional_research_verdicts(hypothesis_id, sequence DESC);

CREATE TRIGGER IF NOT EXISTS institutional_research_evaluations_immutable_update
BEFORE UPDATE ON institutional_research_evaluations
BEGIN SELECT RAISE(ABORT, 'institutional_research_evaluation_immutable'); END;
CREATE TRIGGER IF NOT EXISTS institutional_research_evaluations_immutable_delete
BEFORE DELETE ON institutional_research_evaluations
BEGIN SELECT RAISE(ABORT, 'institutional_research_evaluation_immutable'); END;

CREATE TRIGGER IF NOT EXISTS institutional_research_forward_evidence_immutable_update
BEFORE UPDATE ON institutional_research_forward_evidence
BEGIN SELECT RAISE(ABORT, 'institutional_research_forward_evidence_immutable'); END;
CREATE TRIGGER IF NOT EXISTS institutional_research_forward_evidence_immutable_delete
BEFORE DELETE ON institutional_research_forward_evidence
BEGIN SELECT RAISE(ABORT, 'institutional_research_forward_evidence_immutable'); END;

CREATE TRIGGER IF NOT EXISTS institutional_research_verdicts_immutable_update
BEFORE UPDATE ON institutional_research_verdicts
BEGIN SELECT RAISE(ABORT, 'institutional_research_verdict_immutable'); END;
CREATE TRIGGER IF NOT EXISTS institutional_research_verdicts_immutable_delete
BEFORE DELETE ON institutional_research_verdicts
BEGIN SELECT RAISE(ABORT, 'institutional_research_verdict_immutable'); END;
