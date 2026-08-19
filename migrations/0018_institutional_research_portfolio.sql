CREATE TABLE IF NOT EXISTS institutional_hypotheses (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  family TEXT NOT NULL CHECK (family IN ('trend', 'breakout', 'momentum', 'volatility', 'mean_reversion', 'regime_filter')),
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

CREATE TABLE IF NOT EXISTS institutional_hypothesis_events (
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

CREATE TABLE IF NOT EXISTS institutional_rejection_memory (
  id TEXT PRIMARY KEY,
  hypothesis_id TEXT NOT NULL UNIQUE,
  family TEXT NOT NULL,
  reason_codes_json TEXT NOT NULL,
  evidence_summary TEXT NOT NULL,
  rejection_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  FOREIGN KEY (hypothesis_id) REFERENCES institutional_hypotheses(id)
);

CREATE TABLE IF NOT EXISTS institutional_factory_admissions (
  id TEXT PRIMARY KEY,
  hypothesis_id TEXT NOT NULL UNIQUE,
  family TEXT NOT NULL CHECK (family IN ('trend', 'breakout', 'momentum', 'volatility', 'mean_reversion', 'regime_filter')),
  novelty_basis TEXT NOT NULL,
  expected_information_gain REAL NOT NULL CHECK (expected_information_gain >= 0 AND expected_information_gain <= 1),
  admission_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  FOREIGN KEY (hypothesis_id) REFERENCES institutional_hypotheses(id)
);

CREATE INDEX IF NOT EXISTS idx_institutional_hypotheses_created
  ON institutional_hypotheses(created_at, id);
CREATE INDEX IF NOT EXISTS idx_institutional_hypothesis_events_current
  ON institutional_hypothesis_events(hypothesis_id, sequence DESC);
CREATE INDEX IF NOT EXISTS idx_institutional_rejection_family
  ON institutional_rejection_memory(family, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_institutional_factory_created
  ON institutional_factory_admissions(created_at DESC);

CREATE TRIGGER IF NOT EXISTS institutional_hypotheses_immutable_update
BEFORE UPDATE ON institutional_hypotheses
BEGIN SELECT RAISE(ABORT, 'institutional_hypothesis_immutable'); END;
CREATE TRIGGER IF NOT EXISTS institutional_hypotheses_immutable_delete
BEFORE DELETE ON institutional_hypotheses
BEGIN SELECT RAISE(ABORT, 'institutional_hypothesis_immutable'); END;

CREATE TRIGGER IF NOT EXISTS institutional_hypothesis_events_immutable_update
BEFORE UPDATE ON institutional_hypothesis_events
BEGIN SELECT RAISE(ABORT, 'institutional_hypothesis_event_immutable'); END;
CREATE TRIGGER IF NOT EXISTS institutional_hypothesis_events_immutable_delete
BEFORE DELETE ON institutional_hypothesis_events
BEGIN SELECT RAISE(ABORT, 'institutional_hypothesis_event_immutable'); END;

CREATE TRIGGER IF NOT EXISTS institutional_rejection_memory_immutable_update
BEFORE UPDATE ON institutional_rejection_memory
BEGIN SELECT RAISE(ABORT, 'institutional_rejection_memory_immutable'); END;
CREATE TRIGGER IF NOT EXISTS institutional_rejection_memory_immutable_delete
BEFORE DELETE ON institutional_rejection_memory
BEGIN SELECT RAISE(ABORT, 'institutional_rejection_memory_immutable'); END;

CREATE TRIGGER IF NOT EXISTS institutional_factory_admissions_immutable_update
BEFORE UPDATE ON institutional_factory_admissions
BEGIN SELECT RAISE(ABORT, 'institutional_factory_admission_immutable'); END;
CREATE TRIGGER IF NOT EXISTS institutional_factory_admissions_immutable_delete
BEFORE DELETE ON institutional_factory_admissions
BEGIN SELECT RAISE(ABORT, 'institutional_factory_admission_immutable'); END;
