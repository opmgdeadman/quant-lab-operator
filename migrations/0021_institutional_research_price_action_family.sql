PRAGMA defer_foreign_keys = ON;

DROP TRIGGER IF EXISTS institutional_hypotheses_immutable_update;
DROP TRIGGER IF EXISTS institutional_hypotheses_immutable_delete;
DROP TRIGGER IF EXISTS institutional_factory_admissions_immutable_update;
DROP TRIGGER IF EXISTS institutional_factory_admissions_immutable_delete;

CREATE TABLE institutional_hypotheses_v3 (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  family TEXT NOT NULL CHECK (family IN ('trend', 'breakout', 'momentum', 'volatility', 'mean_reversion', 'regime_filter', 'price_action')),
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
  FOREIGN KEY (lineage_parent_id) REFERENCES institutional_hypotheses_v3(id)
);

INSERT INTO institutional_hypotheses_v3
SELECT id, title, family, origin, market, interval, economic_mechanism, market_premise,
       expected_failure_modes_json, research_function, lineage_parent_id, materially_new_evidence,
       preregistration_json, preregistration_hash, hypothesis_hash, created_at
FROM institutional_hypotheses;

DROP TABLE institutional_hypotheses;
ALTER TABLE institutional_hypotheses_v3 RENAME TO institutional_hypotheses;

CREATE TABLE institutional_factory_admissions_v3 (
  id TEXT PRIMARY KEY,
  hypothesis_id TEXT NOT NULL UNIQUE,
  family TEXT NOT NULL CHECK (family IN ('trend', 'breakout', 'momentum', 'volatility', 'mean_reversion', 'regime_filter', 'price_action')),
  novelty_basis TEXT NOT NULL,
  expected_information_gain REAL NOT NULL CHECK (expected_information_gain >= 0 AND expected_information_gain <= 1),
  admission_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  FOREIGN KEY (hypothesis_id) REFERENCES institutional_hypotheses(id)
);

INSERT INTO institutional_factory_admissions_v3
SELECT id, hypothesis_id, family, novelty_basis, expected_information_gain, admission_hash, created_at
FROM institutional_factory_admissions;

DROP TABLE institutional_factory_admissions;
ALTER TABLE institutional_factory_admissions_v3 RENAME TO institutional_factory_admissions;

CREATE INDEX IF NOT EXISTS idx_institutional_hypotheses_created
  ON institutional_hypotheses(created_at, id);
CREATE INDEX IF NOT EXISTS idx_institutional_factory_created
  ON institutional_factory_admissions(created_at DESC);

CREATE TRIGGER IF NOT EXISTS institutional_hypotheses_immutable_update
BEFORE UPDATE ON institutional_hypotheses
BEGIN SELECT RAISE(ABORT, 'institutional_hypothesis_immutable'); END;
CREATE TRIGGER IF NOT EXISTS institutional_hypotheses_immutable_delete
BEFORE DELETE ON institutional_hypotheses
BEGIN SELECT RAISE(ABORT, 'institutional_hypothesis_immutable'); END;

CREATE TRIGGER IF NOT EXISTS institutional_factory_admissions_immutable_update
BEFORE UPDATE ON institutional_factory_admissions
BEGIN SELECT RAISE(ABORT, 'institutional_factory_admission_immutable'); END;
CREATE TRIGGER IF NOT EXISTS institutional_factory_admissions_immutable_delete
BEFORE DELETE ON institutional_factory_admissions
BEGIN SELECT RAISE(ABORT, 'institutional_factory_admission_immutable'); END;
