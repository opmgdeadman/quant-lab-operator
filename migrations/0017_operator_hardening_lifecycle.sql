CREATE TABLE IF NOT EXISTS operator_hardening_incidents (
  id TEXT PRIMARY KEY,
  signature TEXT NOT NULL UNIQUE,
  operation_id TEXT,
  intent TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('P0', 'P1', 'P2', 'P3')),
  state TEXT NOT NULL CHECK (state IN ('open', 'diagnosed', 'fixed', 'validated', 'deployed', 'verified', 'closed')),
  summary TEXT NOT NULL,
  observed_json TEXT NOT NULL DEFAULT '{}',
  root_cause TEXT,
  generalized_cause TEXT,
  prevention_rule_id TEXT,
  regression_test_ids_json TEXT NOT NULL DEFAULT '[]',
  tested_sha TEXT,
  deployment_id TEXT,
  live_verification_json TEXT NOT NULL DEFAULT '{}',
  resume_capsule_json TEXT NOT NULL DEFAULT '{}',
  resume_result_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  closed_at TEXT
);

CREATE INDEX IF NOT EXISTS operator_hardening_incidents_state_idx
  ON operator_hardening_incidents(state, updated_at);

CREATE TABLE IF NOT EXISTS operator_hardening_incident_events (
  id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL,
  from_state TEXT,
  to_state TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (incident_id) REFERENCES operator_hardening_incidents(id)
);

CREATE INDEX IF NOT EXISTS operator_hardening_incident_events_incident_idx
  ON operator_hardening_incident_events(incident_id, created_at);
