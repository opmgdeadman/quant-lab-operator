CREATE TABLE IF NOT EXISTS live_qualification_policies (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL CHECK (version >= 1),
  policy_json TEXT NOT NULL,
  policy_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS live_qualification_assessments (
  id TEXT PRIMARY KEY,
  policy_id TEXT NOT NULL,
  policy_hash TEXT NOT NULL,
  selection_batch_id TEXT,
  champion_candidate_id TEXT,
  state TEXT NOT NULL CHECK (state IN ('not_qualified', 'eligible_for_owner_review')),
  evidence_json TEXT NOT NULL,
  evidence_hash TEXT NOT NULL,
  blocker_codes_json TEXT NOT NULL,
  gate_count INTEGER NOT NULL CHECK (gate_count >= 1),
  passed_gate_count INTEGER NOT NULL CHECK (passed_gate_count >= 0),
  failed_gate_count INTEGER NOT NULL CHECK (failed_gate_count >= 0),
  assessment_hash TEXT NOT NULL UNIQUE,
  summary_json TEXT NOT NULL,
  owner_approval_required INTEGER NOT NULL CHECK (owner_approval_required = 1),
  owner_approval_present INTEGER NOT NULL CHECK (owner_approval_present = 0),
  live_authorized INTEGER NOT NULL CHECK (live_authorized = 0),
  created_at TEXT NOT NULL,
  FOREIGN KEY (policy_id) REFERENCES live_qualification_policies(id)
);

CREATE TABLE IF NOT EXISTS live_qualification_gate_results (
  id TEXT PRIMARY KEY,
  assessment_id TEXT NOT NULL,
  gate_code TEXT NOT NULL,
  passed INTEGER NOT NULL CHECK (passed IN (0, 1)),
  observed_json TEXT NOT NULL,
  threshold_json TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(assessment_id, gate_code),
  FOREIGN KEY (assessment_id) REFERENCES live_qualification_assessments(id)
);

CREATE INDEX IF NOT EXISTS idx_live_qualification_created
  ON live_qualification_assessments(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_live_qualification_gates
  ON live_qualification_gate_results(assessment_id, gate_code);

CREATE TRIGGER IF NOT EXISTS live_qualification_policies_immutable_update
BEFORE UPDATE ON live_qualification_policies BEGIN SELECT RAISE(ABORT, 'live_qualification_policies_immutable'); END;
CREATE TRIGGER IF NOT EXISTS live_qualification_policies_immutable_delete
BEFORE DELETE ON live_qualification_policies BEGIN SELECT RAISE(ABORT, 'live_qualification_policies_immutable'); END;
CREATE TRIGGER IF NOT EXISTS live_qualification_assessments_immutable_update
BEFORE UPDATE ON live_qualification_assessments BEGIN SELECT RAISE(ABORT, 'live_qualification_assessments_immutable'); END;
CREATE TRIGGER IF NOT EXISTS live_qualification_assessments_immutable_delete
BEFORE DELETE ON live_qualification_assessments BEGIN SELECT RAISE(ABORT, 'live_qualification_assessments_immutable'); END;
CREATE TRIGGER IF NOT EXISTS live_qualification_gate_results_immutable_update
BEFORE UPDATE ON live_qualification_gate_results BEGIN SELECT RAISE(ABORT, 'live_qualification_gate_results_immutable'); END;
CREATE TRIGGER IF NOT EXISTS live_qualification_gate_results_immutable_delete
BEFORE DELETE ON live_qualification_gate_results BEGIN SELECT RAISE(ABORT, 'live_qualification_gate_results_immutable'); END;
