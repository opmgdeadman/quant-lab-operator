CREATE TABLE IF NOT EXISTS selection_policies (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL CHECK (version >= 1),
  policy_json TEXT NOT NULL,
  policy_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS selection_batches (
  id TEXT PRIMARY KEY,
  policy_id TEXT NOT NULL,
  policy_hash TEXT NOT NULL,
  source_factory_batch_id TEXT NOT NULL,
  source_factory_batch_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('champion_selected', 'no_champion')),
  champion_candidate_id TEXT,
  challenger_count INTEGER NOT NULL CHECK (challenger_count >= 0 AND challenger_count <= 2),
  eligible_count INTEGER NOT NULL CHECK (eligible_count >= 0),
  blocker_codes_json TEXT NOT NULL,
  selection_hash TEXT NOT NULL UNIQUE,
  summary_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (policy_id) REFERENCES selection_policies(id)
);

CREATE TABLE IF NOT EXISTS selection_rankings (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  eligible INTEGER NOT NULL CHECK (eligible IN (0, 1)),
  selected_role TEXT NOT NULL CHECK (selected_role IN ('champion', 'challenger', 'none')),
  rank_position INTEGER,
  score REAL,
  verdict TEXT NOT NULL CHECK (verdict IN ('qualified', 'insufficient_evidence', 'rejected')),
  blocker_codes_json TEXT NOT NULL,
  evidence_hash TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(batch_id, candidate_id),
  FOREIGN KEY (batch_id) REFERENCES selection_batches(id),
  FOREIGN KEY (candidate_id) REFERENCES strategy_candidates(id)
);

CREATE INDEX IF NOT EXISTS idx_selection_rankings_batch_rank
  ON selection_rankings(batch_id, eligible DESC, rank_position ASC, candidate_id ASC);

CREATE TRIGGER IF NOT EXISTS selection_policies_immutable_update
BEFORE UPDATE ON selection_policies BEGIN SELECT RAISE(ABORT, 'selection_policies_immutable'); END;
CREATE TRIGGER IF NOT EXISTS selection_policies_immutable_delete
BEFORE DELETE ON selection_policies BEGIN SELECT RAISE(ABORT, 'selection_policies_immutable'); END;
CREATE TRIGGER IF NOT EXISTS selection_batches_immutable_update
BEFORE UPDATE ON selection_batches BEGIN SELECT RAISE(ABORT, 'selection_batches_immutable'); END;
CREATE TRIGGER IF NOT EXISTS selection_batches_immutable_delete
BEFORE DELETE ON selection_batches BEGIN SELECT RAISE(ABORT, 'selection_batches_immutable'); END;
CREATE TRIGGER IF NOT EXISTS selection_rankings_immutable_update
BEFORE UPDATE ON selection_rankings BEGIN SELECT RAISE(ABORT, 'selection_rankings_immutable'); END;
CREATE TRIGGER IF NOT EXISTS selection_rankings_immutable_delete
BEFORE DELETE ON selection_rankings BEGIN SELECT RAISE(ABORT, 'selection_rankings_immutable'); END;
