export const INSTITUTIONAL_INDEPENDENT_JUDGE_POLICY = deepFreeze({
  id: "institutional-independent-judge-v1",
  version: 1,
  historical: {
    minimum_total_closed_trades: 12,
    minimum_positive_test_windows: 3,
    minimum_median_test_return_percent: 0,
    maximum_worst_test_drawdown_percent: 15,
    minimum_doubled_cost_median_return_percent: 0,
    minimum_tripled_cost_median_return_percent: -0.5,
    minimum_distinct_traded_regimes: 2,
  },
  forward: {
    minimum_cycles: 168,
    minimum_closed_trades: 3,
    minimum_return_percent: 0,
    maximum_drawdown_percent: 12,
  },
  caller_supplied_metrics_allowed: false,
  stage13_promotion_authority_changed: false,
  paper_only: true,
  live_capital_enabled: false,
});

export function judgeInstitutionalResearchEvidence({ artifact, forwardEvidence }) {
  assertArtifact(artifact);
  const forward = normalizeForwardEvidence(forwardEvidence);
  const historicalReasons = [];
  const gates = INSTITUTIONAL_INDEPENDENT_JUDGE_POLICY.historical;

  gate(artifact.total_closed_trades >= gates.minimum_total_closed_trades, "insufficient_total_closed_trades", historicalReasons);
  gate(artifact.positive_test_windows >= gates.minimum_positive_test_windows, "insufficient_positive_test_windows", historicalReasons);
  gate(artifact.median_test_return_percent >= gates.minimum_median_test_return_percent, "median_test_return_below_gate", historicalReasons);
  gate(artifact.worst_test_drawdown_percent <= gates.maximum_worst_test_drawdown_percent, "test_drawdown_above_gate", historicalReasons);
  gate(artifact.doubled_cost_median_return_percent >= gates.minimum_doubled_cost_median_return_percent, "doubled_cost_stress_failed", historicalReasons);
  gate(artifact.tripled_cost_median_return_percent >= gates.minimum_tripled_cost_median_return_percent, "tripled_cost_stress_failed", historicalReasons);
  gate(artifact.distinct_traded_regimes >= gates.minimum_distinct_traded_regimes, "insufficient_regime_coverage", historicalReasons);
  gate(artifact.evidence_integrity_passed === true, "evidence_integrity_failed", historicalReasons);
  gate(artifact.execution_model === "next_completed_candle_open", "execution_model_not_allowed", historicalReasons);
  gate(artifact.caller_supplied_performance_metrics === false, "caller_supplied_metrics_detected", historicalReasons);

  const forwardReasons = [];
  const forwardGates = INSTITUTIONAL_INDEPENDENT_JUDGE_POLICY.forward;
  gate(forward.cycle_count >= forwardGates.minimum_cycles, "insufficient_forward_cycles", forwardReasons);
  gate(forward.closed_trade_count >= forwardGates.minimum_closed_trades, "insufficient_forward_closed_trades", forwardReasons);
  gate(forward.return_percent > forwardGates.minimum_return_percent, "forward_return_not_positive", forwardReasons);
  gate(forward.max_drawdown_percent <= forwardGates.maximum_drawdown_percent, "forward_drawdown_above_gate", forwardReasons);
  gate(forward.evidence_integrity_passed === true, "forward_evidence_integrity_failed", forwardReasons);

  const historicalPassed = historicalReasons.length === 0;
  const forwardPassed = forwardReasons.length === 0;
  const verdict = !historicalPassed ? "rejected" : forwardPassed ? "qualified" : "awaiting_forward_evidence";
  return deepFreeze({
    judge_policy_id: INSTITUTIONAL_INDEPENDENT_JUDGE_POLICY.id,
    verdict,
    reason_codes: verdict === "rejected" ? historicalReasons : verdict === "qualified" ? [] : forwardReasons,
    historical_passed: historicalPassed,
    forward_passed: forwardPassed,
    historical_metrics: {
      window_count: artifact.window_count,
      total_closed_trades: artifact.total_closed_trades,
      positive_test_windows: artifact.positive_test_windows,
      median_test_return_percent: artifact.median_test_return_percent,
      worst_test_drawdown_percent: artifact.worst_test_drawdown_percent,
      doubled_cost_median_return_percent: artifact.doubled_cost_median_return_percent,
      tripled_cost_median_return_percent: artifact.tripled_cost_median_return_percent,
      distinct_traded_regimes: artifact.distinct_traded_regimes,
    },
    forward_metrics: forward,
    stage13_promotion_authority_changed: false,
    paper_only: true,
    live_capital_enabled: false,
  });
}

function assertArtifact(artifact) {
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) throw new Error("institutional_judge_artifact_required");
  for (const field of [
    "window_count", "total_closed_trades", "positive_test_windows", "median_test_return_percent",
    "worst_test_drawdown_percent", "doubled_cost_median_return_percent", "tripled_cost_median_return_percent",
    "distinct_traded_regimes",
  ]) {
    const value = Number(artifact[field]);
    if (!Number.isFinite(value)) throw new Error(`institutional_judge_artifact_${field}_invalid`);
  }
  if (artifact.evidence_integrity_passed !== true) return;
  if (artifact.caller_supplied_performance_metrics !== false) throw new Error("institutional_judge_caller_metrics_flag_invalid");
}

function normalizeForwardEvidence(value) {
  const source = value || {};
  return {
    cycle_count: integer(source.cycle_count ?? 0, "cycle_count"),
    closed_trade_count: integer(source.closed_trade_count ?? 0, "closed_trade_count"),
    return_percent: finite(source.return_percent ?? 0, "return_percent"),
    max_drawdown_percent: finite(source.max_drawdown_percent ?? 0, "max_drawdown_percent"),
    evidence_integrity_passed: source.evidence_integrity_passed === true,
  };
}

function gate(condition, code, reasons) { if (!condition) reasons.push(code); }
function finite(value, name) { const number = Number(value); if (!Number.isFinite(number)) throw new Error(`institutional_judge_${name}_invalid`); return number; }
function integer(value, name) { const number = finite(value, name); if (!Number.isInteger(number) || number < 0) throw new Error(`institutional_judge_${name}_invalid`); return number; }
function deepFreeze(value) { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); return value; }
