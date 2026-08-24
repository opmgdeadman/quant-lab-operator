PRAGMA defer_foreign_keys = ON;

CREATE TABLE _ql_bak_hypotheses AS SELECT * FROM institutional_hypotheses;
CREATE TABLE _ql_bak_events AS SELECT * FROM institutional_hypothesis_events;
CREATE TABLE _ql_bak_rejections AS SELECT * FROM institutional_rejection_memory;
CREATE TABLE _ql_bak_factory AS SELECT * FROM institutional_factory_admissions;
CREATE TABLE _ql_bak_evaluations AS SELECT * FROM institutional_research_evaluations;
CREATE TABLE _ql_bak_forward_evidence AS SELECT * FROM institutional_research_forward_evidence;
CREATE TABLE _ql_bak_verdicts AS SELECT * FROM institutional_research_verdicts;
CREATE TABLE _ql_bak_forward_portfolios AS SELECT * FROM institutional_research_forward_portfolios;

DROP TABLE institutional_research_verdicts;
DROP TABLE institutional_research_forward_portfolios;
DROP TABLE institutional_research_forward_evidence;
DROP TABLE institutional_research_evaluations;
DROP TABLE institutional_factory_admissions;
DROP TABLE institutional_rejection_memory;
DROP TABLE institutional_hypothesis_events;
DROP TABLE institutional_hypotheses;

CREATE TABLE institutional_hypotheses (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  family TEXT NOT NULL CHECK (family IN ('trend', 'breakout', 'momentum', 'volatility', 'mean_reversion', 'regime_filter', 'price_action', 'seasonality')),
  origin TEXT NOT NULL CHECK (origin IN ('operator', 'bounded_factory')),
  market TEXT NOT NULL CHECK (market = 'BTC-USD'),
  interval TEXT NOT NULL CHECK (interval = '1h'),
  economic_mechanism TEXT NOT NULL,
  market_premise TEXT NOT NULL,
  expected_failure_modes_json TEXT NOT NULL,
  research_function TEXT NOT NULL CHECK (research_function IN ('alpha_research', 'data_research', 'execution_research', 'portfolio_research', 'risk_research')),
  lineage_parent_id TEXT,
  materially_new_evidence TEXT,
  preregistration_json TEXT NOT NULL,
  preregistration_hash TEXT NOT NULL,
  hypothesis_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  FOREIGN KEY (lineage_parent_id) REFERENCES institutional_hypotheses(id)
);

CREATE TABLE institutional_hypothesis_events (
  id TEXT PRIMARY KEY,
  hypothesis_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence >= 1),
  from_state TEXT CHECK (from_state IS NULL OR from_state IN ('proposed', 'admitted', 'testing', 'rejected', 'qualified', 'retired', 'superseded')),
  to_state TEXT NOT NULL CHECK (to_state IN ('proposed', 'admitted', 'testing', 'rejected', 'qualified', 'retired', 'superseded')),
  reason_codes_json TEXT NOT NULL,
  evidence_summary TEXT NOT NULL,
  independent_verdict_id TEXT,
  event_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  UNIQUE(hypothesis_id, sequence),
  FOREIGN KEY (hypothesis_id) REFERENCES institutional_hypotheses(id)
);

CREATE TABLE institutional_rejection_memory (
  id TEXT PRIMARY KEY,
  hypothesis_id TEXT NOT NULL UNIQUE,
  family TEXT NOT NULL,
  reason_codes_json TEXT NOT NULL,
  evidence_summary TEXT NOT NULL,
  rejection_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  FOREIGN KEY (hypothesis_id) REFERENCES institutional_hypotheses(id)
);

CREATE TABLE institutional_factory_admissions (
  id TEXT PRIMARY KEY,
  hypothesis_id TEXT NOT NULL UNIQUE,
  family TEXT NOT NULL CHECK (family IN ('trend', 'breakout', 'momentum', 'volatility', 'mean_reversion', 'regime_filter', 'price_action', 'seasonality')),
  novelty_basis TEXT NOT NULL,
  expected_information_gain REAL NOT NULL CHECK (expected_information_gain >= 0 AND expected_information_gain <= 1),
  admission_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  FOREIGN KEY (hypothesis_id) REFERENCES institutional_hypotheses(id)
);

CREATE TABLE institutional_research_evaluations (
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

CREATE TABLE institutional_research_forward_evidence (
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

CREATE TABLE institutional_research_forward_portfolios (
  hypothesis_id TEXT PRIMARY KEY,
  testing_started_at TEXT NOT NULL,
  initial_equity REAL NOT NULL CHECK (initial_equity > 0),
  cash_balance REAL NOT NULL,
  position_quantity REAL NOT NULL,
  average_entry REAL NOT NULL CHECK (average_entry >= 0),
  realized_pnl REAL NOT NULL,
  unrealized_pnl REAL NOT NULL,
  total_fees REAL NOT NULL CHECK (total_fees >= 0),
  total_carry REAL NOT NULL,
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

CREATE TABLE institutional_research_verdicts (
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

INSERT INTO institutional_hypotheses SELECT * FROM _ql_bak_hypotheses;
INSERT INTO institutional_hypothesis_events SELECT * FROM _ql_bak_events;
INSERT INTO institutional_rejection_memory SELECT * FROM _ql_bak_rejections;
INSERT INTO institutional_factory_admissions SELECT * FROM _ql_bak_factory;
INSERT INTO institutional_research_evaluations SELECT * FROM _ql_bak_evaluations;
INSERT INTO institutional_research_forward_evidence SELECT * FROM _ql_bak_forward_evidence;
INSERT INTO institutional_research_forward_portfolios SELECT * FROM _ql_bak_forward_portfolios;
INSERT INTO institutional_research_verdicts SELECT * FROM _ql_bak_verdicts;

DROP TABLE _ql_bak_hypotheses;
DROP TABLE _ql_bak_events;
DROP TABLE _ql_bak_rejections;
DROP TABLE _ql_bak_factory;
DROP TABLE _ql_bak_evaluations;
DROP TABLE _ql_bak_forward_evidence;
DROP TABLE _ql_bak_verdicts;
DROP TABLE _ql_bak_forward_portfolios;

CREATE INDEX idx_institutional_hypotheses_created ON institutional_hypotheses(created_at, id);
CREATE INDEX idx_institutional_hypothesis_events_current ON institutional_hypothesis_events(hypothesis_id, sequence DESC);
CREATE INDEX idx_institutional_rejection_family ON institutional_rejection_memory(family, created_at DESC);
CREATE INDEX idx_institutional_factory_created ON institutional_factory_admissions(created_at DESC);
CREATE INDEX idx_institutional_evaluation_created ON institutional_research_evaluations(created_at DESC);
CREATE INDEX idx_institutional_forward_hypothesis_time ON institutional_research_forward_evidence(hypothesis_id, expected_closed_at ASC, cycle_id ASC);
CREATE INDEX idx_institutional_forward_portfolio_updated ON institutional_research_forward_portfolios(updated_at DESC);
CREATE INDEX idx_institutional_verdict_latest ON institutional_research_verdicts(hypothesis_id, sequence DESC);

CREATE TRIGGER institutional_hypotheses_immutable_update BEFORE UPDATE ON institutional_hypotheses BEGIN SELECT RAISE(ABORT, 'institutional_hypothesis_immutable'); END;
CREATE TRIGGER institutional_hypotheses_immutable_delete BEFORE DELETE ON institutional_hypotheses BEGIN SELECT RAISE(ABORT, 'institutional_hypothesis_immutable'); END;
CREATE TRIGGER institutional_hypothesis_events_immutable_update BEFORE UPDATE ON institutional_hypothesis_events BEGIN SELECT RAISE(ABORT, 'institutional_hypothesis_event_immutable'); END;
CREATE TRIGGER institutional_hypothesis_events_immutable_delete BEFORE DELETE ON institutional_hypothesis_events BEGIN SELECT RAISE(ABORT, 'institutional_hypothesis_event_immutable'); END;
CREATE TRIGGER institutional_rejection_memory_immutable_update BEFORE UPDATE ON institutional_rejection_memory BEGIN SELECT RAISE(ABORT, 'institutional_rejection_memory_immutable'); END;
CREATE TRIGGER institutional_rejection_memory_immutable_delete BEFORE DELETE ON institutional_rejection_memory BEGIN SELECT RAISE(ABORT, 'institutional_rejection_memory_immutable'); END;
CREATE TRIGGER institutional_factory_admissions_immutable_update BEFORE UPDATE ON institutional_factory_admissions BEGIN SELECT RAISE(ABORT, 'institutional_factory_admission_immutable'); END;
CREATE TRIGGER institutional_factory_admissions_immutable_delete BEFORE DELETE ON institutional_factory_admissions BEGIN SELECT RAISE(ABORT, 'institutional_factory_admission_immutable'); END;
CREATE TRIGGER institutional_research_evaluations_immutable_update BEFORE UPDATE ON institutional_research_evaluations BEGIN SELECT RAISE(ABORT, 'institutional_research_evaluation_immutable'); END;
CREATE TRIGGER institutional_research_evaluations_immutable_delete BEFORE DELETE ON institutional_research_evaluations BEGIN SELECT RAISE(ABORT, 'institutional_research_evaluation_immutable'); END;
CREATE TRIGGER institutional_research_forward_evidence_immutable_update BEFORE UPDATE ON institutional_research_forward_evidence BEGIN SELECT RAISE(ABORT, 'institutional_research_forward_evidence_immutable'); END;
CREATE TRIGGER institutional_research_forward_evidence_immutable_delete BEFORE DELETE ON institutional_research_forward_evidence BEGIN SELECT RAISE(ABORT, 'institutional_research_forward_evidence_immutable'); END;
CREATE TRIGGER institutional_research_verdicts_immutable_update BEFORE UPDATE ON institutional_research_verdicts BEGIN SELECT RAISE(ABORT, 'institutional_research_verdict_immutable'); END;
CREATE TRIGGER institutional_research_verdicts_immutable_delete BEFORE DELETE ON institutional_research_verdicts BEGIN SELECT RAISE(ABORT, 'institutional_research_verdict_immutable'); END;

PRAGMA defer_foreign_keys = OFF;
