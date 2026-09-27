-- Quant Lab dormant storage salvage, 2026-09-27.
-- Keep schema, policy/config/reference definitions, operator audit/hardening records,
-- and the latest 168 hourly market candles. Purge accumulated runtime/research history.
-- Immutable DELETE guards are suspended only for the historical tables being purged
-- and are recreated before this migration commits.

PRAGMA defer_foreign_keys = ON;

CREATE TABLE IF NOT EXISTS quant_storage_salvage_receipts (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL,
  mode TEXT NOT NULL,
  retained_market_candles INTEGER NOT NULL,
  market_candles_before INTEGER NOT NULL,
  market_candles_after INTEGER NOT NULL DEFAULT 0,
  baseline_trades_before INTEGER NOT NULL,
  baseline_trades_after INTEGER NOT NULL DEFAULT 0,
  strategy_candidate_runs_before INTEGER NOT NULL,
  strategy_candidate_runs_after INTEGER NOT NULL DEFAULT 0,
  strategy_candidate_trades_before INTEGER NOT NULL,
  strategy_candidate_trades_after INTEGER NOT NULL DEFAULT 0,
  directional_research_runs_before INTEGER NOT NULL,
  directional_research_runs_after INTEGER NOT NULL DEFAULT 0,
  institutional_evidence_before INTEGER NOT NULL,
  institutional_evidence_after INTEGER NOT NULL DEFAULT 0,
  external_observations_before INTEGER NOT NULL,
  external_observations_after INTEGER NOT NULL DEFAULT 0,
  rows_purged INTEGER NOT NULL DEFAULT 0
);

INSERT OR REPLACE INTO quant_storage_salvage_receipts (
  id, applied_at, mode, retained_market_candles,
  market_candles_before,
  baseline_trades_before,
  strategy_candidate_runs_before,
  strategy_candidate_trades_before,
  directional_research_runs_before,
  institutional_evidence_before,
  external_observations_before
)
SELECT
  'dormant-salvage-20260927',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  'dormant-minimal-recovery',
  168,
  (SELECT COUNT(*) FROM market_candles),
  (SELECT COUNT(*) FROM baseline_trades),
  (SELECT COUNT(*) FROM strategy_candidate_runs),
  (SELECT COUNT(*) FROM strategy_candidate_trades),
  (SELECT COUNT(*) FROM directional_research_runs),
  (SELECT COUNT(*) FROM institutional_research_forward_evidence),
  (SELECT COUNT(*) FROM external_observations);

-- Suspend immutable DELETE guards only for history/runtime rows explicitly purged below.
DROP TRIGGER IF EXISTS paper_orders_immutable_delete;
DROP TRIGGER IF EXISTS paper_fills_immutable_delete;
DROP TRIGGER IF EXISTS paper_cash_immutable_delete;
DROP TRIGGER IF EXISTS paper_valuations_immutable_delete;
DROP TRIGGER IF EXISTS paper_receipts_immutable_delete;

DROP TRIGGER IF EXISTS baseline_benchmarks_immutable_delete;
DROP TRIGGER IF EXISTS baseline_runs_immutable_delete;
DROP TRIGGER IF EXISTS baseline_trades_immutable_delete;
DROP TRIGGER IF EXISTS baseline_artifacts_immutable_delete;

DROP TRIGGER IF EXISTS hostile_judge_batches_immutable_delete;
DROP TRIGGER IF EXISTS hostile_judge_evaluations_immutable_delete;
DROP TRIGGER IF EXISTS hostile_judge_gate_results_immutable_delete;
DROP TRIGGER IF EXISTS hostile_judge_stress_results_immutable_delete;

DROP TRIGGER IF EXISTS strategy_candidate_runs_immutable_delete;
DROP TRIGGER IF EXISTS strategy_candidate_trades_immutable_delete;
DROP TRIGGER IF EXISTS strategy_candidate_artifacts_immutable_delete;
DROP TRIGGER IF EXISTS strategy_candidate_verdicts_immutable_delete;
DROP TRIGGER IF EXISTS strategy_candidate_gate_results_immutable_delete;
DROP TRIGGER IF EXISTS strategy_candidate_stress_results_immutable_delete;

DROP TRIGGER IF EXISTS selection_batches_immutable_delete;
DROP TRIGGER IF EXISTS selection_rankings_immutable_delete;

DROP TRIGGER IF EXISTS forward_operation_cycles_immutable_delete;
DROP TRIGGER IF EXISTS forward_operation_decisions_immutable_delete;
DROP TRIGGER IF EXISTS forward_scheduler_receipts_immutable_delete;

DROP TRIGGER IF EXISTS live_qualification_assessments_immutable_delete;
DROP TRIGGER IF EXISTS live_qualification_gate_results_immutable_delete;

DROP TRIGGER IF EXISTS rolling_research_epochs_immutable_delete;
DROP TRIGGER IF EXISTS rolling_research_scheduler_receipts_immutable_delete;

DROP TRIGGER IF EXISTS historical_bootstrap_chunks_immutable_delete;
DROP TRIGGER IF EXISTS historical_bootstrap_attempts_immutable_delete;

DROP TRIGGER IF EXISTS directional_shadow_cycles_immutable_delete;
DROP TRIGGER IF EXISTS directional_shadow_candidate_cycles_immutable_delete;
DROP TRIGGER IF EXISTS directional_shadow_scheduler_immutable_delete;

DROP TRIGGER IF EXISTS directional_research_batches_immutable_delete;

DROP TRIGGER IF EXISTS directional_forward_cycles_immutable_delete;
DROP TRIGGER IF EXISTS directional_forward_executions_immutable_delete;
DROP TRIGGER IF EXISTS directional_forward_scheduler_immutable_delete;

DROP TRIGGER IF EXISTS institutional_hypotheses_immutable_delete;
DROP TRIGGER IF EXISTS institutional_hypothesis_events_immutable_delete;
DROP TRIGGER IF EXISTS institutional_rejection_memory_immutable_delete;
DROP TRIGGER IF EXISTS institutional_factory_admissions_immutable_delete;
DROP TRIGGER IF EXISTS institutional_research_evaluations_immutable_delete;
DROP TRIGGER IF EXISTS institutional_research_forward_evidence_immutable_delete;
DROP TRIGGER IF EXISTS institutional_research_verdicts_immutable_delete;

-- Large external observations and institutional research history.
DELETE FROM external_observations;

DELETE FROM institutional_research_forward_portfolios;
DELETE FROM institutional_research_verdicts;
DELETE FROM institutional_research_forward_evidence;
DELETE FROM institutional_research_evaluations;
DELETE FROM institutional_hypothesis_events;
DELETE FROM institutional_factory_admissions;
DELETE FROM institutional_rejection_memory;
DELETE FROM institutional_hypotheses;

-- Directional forward/research/shadow history. Candidate and policy definitions remain.
DELETE FROM directional_forward_executions;
DELETE FROM directional_forward_scheduler_receipts;
DELETE FROM directional_forward_cycles;
DELETE FROM directional_main_portfolios;

DELETE FROM directional_research_portfolio_selections;
DELETE FROM directional_research_verdicts;
DELETE FROM directional_research_runs;
DELETE FROM directional_research_windows;
DELETE FROM directional_research_batches;

DELETE FROM directional_shadow_candidate_cycles;
DELETE FROM directional_shadow_scheduler_receipts;
DELETE FROM directional_shadow_cycles;
DELETE FROM directional_shadow_portfolios;

-- Historical/rolling/live-qualification evidence.
DELETE FROM historical_bootstrap_attempts;
DELETE FROM historical_bootstrap_chunks;

DELETE FROM rolling_research_scheduler_receipts;
DELETE FROM rolling_research_epochs;

DELETE FROM live_qualification_gate_results;
DELETE FROM live_qualification_assessments;

-- Forward/selection history.
DELETE FROM forward_scheduler_receipts;
DELETE FROM forward_operation_decisions;
DELETE FROM forward_operation_cycles;

DELETE FROM selection_rankings;
DELETE FROM selection_batches;

-- Strategy-factory outputs. Preserve factory policies, batches, and fixed candidate definitions.
DELETE FROM strategy_candidate_stress_results;
DELETE FROM strategy_candidate_gate_results;
DELETE FROM strategy_candidate_verdicts;
DELETE FROM strategy_candidate_artifacts;
DELETE FROM strategy_candidate_trades;
DELETE FROM strategy_candidate_runs;

-- Hostile-judge and baseline evidence. Preserve immutable configs/definitions.
DELETE FROM hostile_judge_stress_results;
DELETE FROM hostile_judge_gate_results;
DELETE FROM hostile_judge_evaluations;
DELETE FROM hostile_judge_batches;

DELETE FROM baseline_artifacts;
DELETE FROM baseline_trades;
DELETE FROM baseline_runs;
DELETE FROM baseline_benchmarks;

-- Paper execution history.
DELETE FROM paper_cycle_receipts;
DELETE FROM paper_valuation_snapshots;
DELETE FROM paper_cash_ledger;
DELETE FROM paper_positions;
DELETE FROM paper_fills;
DELETE FROM paper_orders;
DELETE FROM paper_portfolios;

DELETE FROM market_data_ingestion_runs;

-- Keep one week of hourly candles as a minimal recovery/inspection tail.
DELETE FROM market_candles
WHERE id NOT IN (
  SELECT id
  FROM market_candles
  ORDER BY closed_at DESC
  LIMIT 168
);

UPDATE quant_storage_salvage_receipts
SET
  market_candles_after = (SELECT COUNT(*) FROM market_candles),
  baseline_trades_after = (SELECT COUNT(*) FROM baseline_trades),
  strategy_candidate_runs_after = (SELECT COUNT(*) FROM strategy_candidate_runs),
  strategy_candidate_trades_after = (SELECT COUNT(*) FROM strategy_candidate_trades),
  directional_research_runs_after = (SELECT COUNT(*) FROM directional_research_runs),
  institutional_evidence_after = (SELECT COUNT(*) FROM institutional_research_forward_evidence),
  external_observations_after = (SELECT COUNT(*) FROM external_observations),
  rows_purged =
      market_candles_before - (SELECT COUNT(*) FROM market_candles)
    + baseline_trades_before - (SELECT COUNT(*) FROM baseline_trades)
    + strategy_candidate_runs_before - (SELECT COUNT(*) FROM strategy_candidate_runs)
    + strategy_candidate_trades_before - (SELECT COUNT(*) FROM strategy_candidate_trades)
    + directional_research_runs_before - (SELECT COUNT(*) FROM directional_research_runs)
    + institutional_evidence_before - (SELECT COUNT(*) FROM institutional_research_forward_evidence)
    + external_observations_before - (SELECT COUNT(*) FROM external_observations)
WHERE id = 'dormant-salvage-20260927';

-- Restore every suspended immutable DELETE guard before commit.
CREATE TRIGGER IF NOT EXISTS paper_orders_immutable_delete
BEFORE DELETE ON paper_orders BEGIN SELECT RAISE(ABORT, 'paper_orders_immutable'); END;
CREATE TRIGGER IF NOT EXISTS paper_fills_immutable_delete
BEFORE DELETE ON paper_fills BEGIN SELECT RAISE(ABORT, 'paper_fills_immutable'); END;
CREATE TRIGGER IF NOT EXISTS paper_cash_immutable_delete
BEFORE DELETE ON paper_cash_ledger BEGIN SELECT RAISE(ABORT, 'paper_cash_ledger_immutable'); END;
CREATE TRIGGER IF NOT EXISTS paper_valuations_immutable_delete
BEFORE DELETE ON paper_valuation_snapshots BEGIN SELECT RAISE(ABORT, 'paper_valuations_immutable'); END;
CREATE TRIGGER IF NOT EXISTS paper_receipts_immutable_delete
BEFORE DELETE ON paper_cycle_receipts BEGIN SELECT RAISE(ABORT, 'paper_cycle_receipts_immutable'); END;

CREATE TRIGGER IF NOT EXISTS baseline_benchmarks_immutable_delete
BEFORE DELETE ON baseline_benchmarks BEGIN SELECT RAISE(ABORT, 'baseline_benchmarks_immutable'); END;
CREATE TRIGGER IF NOT EXISTS baseline_runs_immutable_delete
BEFORE DELETE ON baseline_runs BEGIN SELECT RAISE(ABORT, 'baseline_runs_immutable'); END;
CREATE TRIGGER IF NOT EXISTS baseline_trades_immutable_delete
BEFORE DELETE ON baseline_trades BEGIN SELECT RAISE(ABORT, 'baseline_trades_immutable'); END;
CREATE TRIGGER IF NOT EXISTS baseline_artifacts_immutable_delete
BEFORE DELETE ON baseline_artifacts BEGIN SELECT RAISE(ABORT, 'baseline_artifacts_immutable'); END;

CREATE TRIGGER IF NOT EXISTS hostile_judge_batches_immutable_delete
BEFORE DELETE ON hostile_judge_batches BEGIN SELECT RAISE(ABORT, 'hostile_judge_batches_immutable'); END;
CREATE TRIGGER IF NOT EXISTS hostile_judge_evaluations_immutable_delete
BEFORE DELETE ON hostile_judge_evaluations BEGIN SELECT RAISE(ABORT, 'hostile_judge_evaluations_immutable'); END;
CREATE TRIGGER IF NOT EXISTS hostile_judge_gate_results_immutable_delete
BEFORE DELETE ON hostile_judge_gate_results BEGIN SELECT RAISE(ABORT, 'hostile_judge_gate_results_immutable'); END;
CREATE TRIGGER IF NOT EXISTS hostile_judge_stress_results_immutable_delete
BEFORE DELETE ON hostile_judge_stress_results BEGIN SELECT RAISE(ABORT, 'hostile_judge_stress_results_immutable'); END;

CREATE TRIGGER IF NOT EXISTS strategy_candidate_runs_immutable_delete
BEFORE DELETE ON strategy_candidate_runs BEGIN SELECT RAISE(ABORT, 'strategy_candidate_runs_immutable'); END;
CREATE TRIGGER IF NOT EXISTS strategy_candidate_trades_immutable_delete
BEFORE DELETE ON strategy_candidate_trades BEGIN SELECT RAISE(ABORT, 'strategy_candidate_trades_immutable'); END;
CREATE TRIGGER IF NOT EXISTS strategy_candidate_artifacts_immutable_delete
BEFORE DELETE ON strategy_candidate_artifacts BEGIN SELECT RAISE(ABORT, 'strategy_candidate_artifacts_immutable'); END;
CREATE TRIGGER IF NOT EXISTS strategy_candidate_verdicts_immutable_delete
BEFORE DELETE ON strategy_candidate_verdicts BEGIN SELECT RAISE(ABORT, 'strategy_candidate_verdicts_immutable'); END;
CREATE TRIGGER IF NOT EXISTS strategy_candidate_gate_results_immutable_delete
BEFORE DELETE ON strategy_candidate_gate_results BEGIN SELECT RAISE(ABORT, 'strategy_candidate_gate_results_immutable'); END;
CREATE TRIGGER IF NOT EXISTS strategy_candidate_stress_results_immutable_delete
BEFORE DELETE ON strategy_candidate_stress_results BEGIN SELECT RAISE(ABORT, 'strategy_candidate_stress_results_immutable'); END;

CREATE TRIGGER IF NOT EXISTS selection_batches_immutable_delete
BEFORE DELETE ON selection_batches BEGIN SELECT RAISE(ABORT, 'selection_batches_immutable'); END;
CREATE TRIGGER IF NOT EXISTS selection_rankings_immutable_delete
BEFORE DELETE ON selection_rankings BEGIN SELECT RAISE(ABORT, 'selection_rankings_immutable'); END;

CREATE TRIGGER IF NOT EXISTS forward_operation_cycles_immutable_delete
BEFORE DELETE ON forward_operation_cycles BEGIN SELECT RAISE(ABORT, 'forward_operation_cycles_immutable'); END;
CREATE TRIGGER IF NOT EXISTS forward_operation_decisions_immutable_delete
BEFORE DELETE ON forward_operation_decisions BEGIN SELECT RAISE(ABORT, 'forward_operation_decisions_immutable'); END;
CREATE TRIGGER IF NOT EXISTS forward_scheduler_receipts_immutable_delete
BEFORE DELETE ON forward_scheduler_receipts BEGIN SELECT RAISE(ABORT, 'forward_scheduler_receipts_immutable'); END;

CREATE TRIGGER IF NOT EXISTS live_qualification_assessments_immutable_delete
BEFORE DELETE ON live_qualification_assessments BEGIN SELECT RAISE(ABORT, 'live_qualification_assessments_immutable'); END;
CREATE TRIGGER IF NOT EXISTS live_qualification_gate_results_immutable_delete
BEFORE DELETE ON live_qualification_gate_results BEGIN SELECT RAISE(ABORT, 'live_qualification_gate_results_immutable'); END;

CREATE TRIGGER IF NOT EXISTS rolling_research_epochs_immutable_delete
BEFORE DELETE ON rolling_research_epochs BEGIN SELECT RAISE(ABORT, 'rolling_research_epochs_immutable'); END;
CREATE TRIGGER IF NOT EXISTS rolling_research_scheduler_receipts_immutable_delete
BEFORE DELETE ON rolling_research_scheduler_receipts BEGIN SELECT RAISE(ABORT, 'rolling_research_scheduler_receipts_immutable'); END;

CREATE TRIGGER IF NOT EXISTS historical_bootstrap_chunks_immutable_delete
BEFORE DELETE ON historical_bootstrap_chunks BEGIN SELECT RAISE(ABORT, 'historical_bootstrap_chunks_immutable'); END;
CREATE TRIGGER IF NOT EXISTS historical_bootstrap_attempts_immutable_delete
BEFORE DELETE ON historical_bootstrap_attempts BEGIN SELECT RAISE(ABORT, 'historical_bootstrap_attempts_immutable'); END;

CREATE TRIGGER IF NOT EXISTS directional_shadow_cycles_immutable_delete
BEFORE DELETE ON directional_shadow_cycles
BEGIN SELECT RAISE(ABORT, 'directional_shadow_cycles_immutable'); END;
CREATE TRIGGER IF NOT EXISTS directional_shadow_candidate_cycles_immutable_delete
BEFORE DELETE ON directional_shadow_candidate_cycles
BEGIN SELECT RAISE(ABORT, 'directional_shadow_candidate_cycles_immutable'); END;
CREATE TRIGGER IF NOT EXISTS directional_shadow_scheduler_immutable_delete
BEFORE DELETE ON directional_shadow_scheduler_receipts
BEGIN SELECT RAISE(ABORT, 'directional_shadow_scheduler_receipts_immutable'); END;

CREATE TRIGGER IF NOT EXISTS directional_research_batches_immutable_delete
BEFORE DELETE ON directional_research_batches
BEGIN SELECT RAISE(ABORT, 'directional_research_batch_immutable'); END;

CREATE TRIGGER IF NOT EXISTS directional_forward_cycles_immutable_delete
BEFORE DELETE ON directional_forward_cycles
BEGIN SELECT RAISE(ABORT, 'directional_forward_cycle_immutable'); END;
CREATE TRIGGER IF NOT EXISTS directional_forward_executions_immutable_delete
BEFORE DELETE ON directional_forward_executions
BEGIN SELECT RAISE(ABORT, 'directional_forward_execution_immutable'); END;
CREATE TRIGGER IF NOT EXISTS directional_forward_scheduler_immutable_delete
BEFORE DELETE ON directional_forward_scheduler_receipts
BEGIN SELECT RAISE(ABORT, 'directional_forward_scheduler_immutable'); END;

CREATE TRIGGER IF NOT EXISTS institutional_hypotheses_immutable_delete
BEFORE DELETE ON institutional_hypotheses
BEGIN SELECT RAISE(ABORT, 'institutional_hypothesis_immutable'); END;
CREATE TRIGGER IF NOT EXISTS institutional_hypothesis_events_immutable_delete
BEFORE DELETE ON institutional_hypothesis_events
BEGIN SELECT RAISE(ABORT, 'institutional_hypothesis_event_immutable'); END;
CREATE TRIGGER IF NOT EXISTS institutional_rejection_memory_immutable_delete
BEFORE DELETE ON institutional_rejection_memory
BEGIN SELECT RAISE(ABORT, 'institutional_rejection_memory_immutable'); END;
CREATE TRIGGER IF NOT EXISTS institutional_factory_admissions_immutable_delete
BEFORE DELETE ON institutional_factory_admissions
BEGIN SELECT RAISE(ABORT, 'institutional_factory_admission_immutable'); END;
CREATE TRIGGER IF NOT EXISTS institutional_research_evaluations_immutable_delete
BEFORE DELETE ON institutional_research_evaluations
BEGIN SELECT RAISE(ABORT, 'institutional_research_evaluation_immutable'); END;
CREATE TRIGGER IF NOT EXISTS institutional_research_forward_evidence_immutable_delete
BEFORE DELETE ON institutional_research_forward_evidence
BEGIN SELECT RAISE(ABORT, 'institutional_research_forward_evidence_immutable'); END;
CREATE TRIGGER IF NOT EXISTS institutional_research_verdicts_immutable_delete
BEFORE DELETE ON institutional_research_verdicts
BEGIN SELECT RAISE(ABORT, 'institutional_research_verdict_immutable'); END;

PRAGMA defer_foreign_keys = OFF;
