CREATE TABLE IF NOT EXISTS historical_bootstrap_policies (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL CHECK (version >= 1),
  policy_json TEXT NOT NULL,
  policy_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS historical_bootstrap_chunks (
  id TEXT PRIMARY KEY,
  policy_id TEXT NOT NULL,
  policy_hash TEXT NOT NULL,
  start_closed_at TEXT NOT NULL,
  end_closed_at TEXT NOT NULL,
  requested_hours INTEGER NOT NULL CHECK (requested_hours BETWEEN 1 AND 250),
  provider TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('complete', 'blocked')),
  fetched_count INTEGER NOT NULL CHECK (fetched_count >= 0),
  inserted_count INTEGER NOT NULL CHECK (inserted_count >= 0),
  duplicate_count INTEGER NOT NULL CHECK (duplicate_count >= 0),
  contiguous_before INTEGER NOT NULL CHECK (contiguous_before >= 0),
  contiguous_after INTEGER NOT NULL CHECK (contiguous_after >= 0),
  blocker_code TEXT,
  summary_json TEXT NOT NULL,
  chunk_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  FOREIGN KEY (policy_id) REFERENCES historical_bootstrap_policies(id),
  UNIQUE (start_closed_at, end_closed_at)
);

CREATE TABLE IF NOT EXISTS historical_bootstrap_attempts (
  id TEXT PRIMARY KEY,
  policy_id TEXT NOT NULL,
  policy_hash TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('in_progress', 'complete', 'blocked')),
  contiguous_before INTEGER NOT NULL CHECK (contiguous_before >= 0),
  contiguous_after INTEGER NOT NULL CHECK (contiguous_after >= 0),
  chunks_planned INTEGER NOT NULL CHECK (chunks_planned >= 0),
  chunks_completed INTEGER NOT NULL CHECK (chunks_completed >= 0),
  blocker_codes_json TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  attempt_hash TEXT NOT NULL UNIQUE,
  FOREIGN KEY (policy_id) REFERENCES historical_bootstrap_policies(id)
);

CREATE INDEX IF NOT EXISTS idx_historical_bootstrap_chunks_created
  ON historical_bootstrap_chunks(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_historical_bootstrap_attempts_completed
  ON historical_bootstrap_attempts(completed_at DESC);

CREATE TRIGGER IF NOT EXISTS historical_bootstrap_policies_immutable_update
BEFORE UPDATE ON historical_bootstrap_policies BEGIN SELECT RAISE(ABORT, 'historical_bootstrap_policies_immutable'); END;
CREATE TRIGGER IF NOT EXISTS historical_bootstrap_policies_immutable_delete
BEFORE DELETE ON historical_bootstrap_policies BEGIN SELECT RAISE(ABORT, 'historical_bootstrap_policies_immutable'); END;
CREATE TRIGGER IF NOT EXISTS historical_bootstrap_chunks_immutable_update
BEFORE UPDATE ON historical_bootstrap_chunks BEGIN SELECT RAISE(ABORT, 'historical_bootstrap_chunks_immutable'); END;
CREATE TRIGGER IF NOT EXISTS historical_bootstrap_chunks_immutable_delete
BEFORE DELETE ON historical_bootstrap_chunks BEGIN SELECT RAISE(ABORT, 'historical_bootstrap_chunks_immutable'); END;
CREATE TRIGGER IF NOT EXISTS historical_bootstrap_attempts_immutable_update
BEFORE UPDATE ON historical_bootstrap_attempts BEGIN SELECT RAISE(ABORT, 'historical_bootstrap_attempts_immutable'); END;
CREATE TRIGGER IF NOT EXISTS historical_bootstrap_attempts_immutable_delete
BEFORE DELETE ON historical_bootstrap_attempts BEGIN SELECT RAISE(ABORT, 'historical_bootstrap_attempts_immutable'); END;
