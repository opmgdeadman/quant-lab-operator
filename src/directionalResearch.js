const DEFAULT_POLICY = Object.freeze({
  id: "directional-walk-forward-v1",
  required_candles: 4320,
  train_candles: 1440,
  validation_candles: 480,
  test_candles: 480,
  step_candles: 480,
  minimum_windows: 5,
  base_fee_bps: 10,
  base_slippage_bps: 5,
  short_carry_bps_per_day: 3,
  cost_stress_multipliers: Object.freeze([1, 2, 3]),
  gates: Object.freeze({
    minimum_total_closed_trades: 12,
    minimum_positive_test_windows: 3,
    minimum_median_test_return_percent: 0,
    maximum_worst_test_drawdown_percent: 15,
    minimum_doubled_cost_median_return_percent: 0,
    minimum_tripled_cost_median_return_percent: -0.5,
    maximum_parameter_fragility_percent: 35,
    minimum_shadow_cycles: 168,
    minimum_shadow_closed_trades: 3,
    maximum_shadow_drawdown_percent: 12,
  }),
});

export const DIRECTIONAL_RESEARCH_POLICY = DEFAULT_POLICY;

export function buildWalkForwardWindows(candles, policy = DEFAULT_POLICY) {
  assertCandles(candles, policy.required_candles);
  const width = policy.train_candles + policy.validation_candles + policy.test_candles;
  const windows = [];
  for (let start = 0; start + width <= candles.length; start += policy.step_candles) {
    const trainEnd = start + policy.train_candles;
    const validationEnd = trainEnd + policy.validation_candles;
    const testEnd = validationEnd + policy.test_candles;
    windows.push(Object.freeze({
      id: `${policy.id}:window:${String(windows.length + 1).padStart(2, "0")}`,
      train: freezeSlice(candles, start, trainEnd),
      validation: freezeSlice(candles, trainEnd, validationEnd),
      test: freezeSlice(candles, validationEnd, testEnd),
      start_closed_at: candles[start].closed_at,
      end_closed_at: candles[testEnd - 1].closed_at,
    }));
  }
  if (windows.length < policy.minimum_windows) throw new Error("insufficient_walk_forward_windows");
  return Object.freeze(windows);
}

export function judgeDirectionalCandidate(input, policy = DEFAULT_POLICY) {
  const windows = requireArray(input.windows, "windows");
  const shadow = input.shadow || {};
  const reasons = [];
  const testReturns = windows.map((row) => finite(row.test_return_percent, "test_return_percent"));
  const doubled = windows.map((row) => finite(row.doubled_cost_return_percent, "doubled_cost_return_percent"));
  const tripled = windows.map((row) => finite(row.tripled_cost_return_percent, "tripled_cost_return_percent"));
  const drawdowns = windows.map((row) => finite(row.test_drawdown_percent, "test_drawdown_percent"));
  const totalTrades = sum(windows.map((row) => integer(row.closed_trade_count, "closed_trade_count")));
  const positiveWindows = testReturns.filter((value) => value > 0).length;
  const fragility = finite(input.parameter_fragility_percent ?? 100, "parameter_fragility_percent");
  const gates = policy.gates;

  gate(totalTrades >= gates.minimum_total_closed_trades, "insufficient_total_closed_trades", reasons);
  gate(positiveWindows >= gates.minimum_positive_test_windows, "insufficient_positive_test_windows", reasons);
  gate(median(testReturns) >= gates.minimum_median_test_return_percent, "median_test_return_below_gate", reasons);
  gate(Math.max(...drawdowns) <= gates.maximum_worst_test_drawdown_percent, "test_drawdown_above_gate", reasons);
  gate(median(doubled) >= gates.minimum_doubled_cost_median_return_percent, "doubled_cost_stress_failed", reasons);
  gate(median(tripled) >= gates.minimum_tripled_cost_median_return_percent, "tripled_cost_stress_failed", reasons);
  gate(fragility <= gates.maximum_parameter_fragility_percent, "parameter_fragility_above_gate", reasons);
  gate(integer(shadow.cycle_count ?? 0, "shadow_cycle_count") >= gates.minimum_shadow_cycles, "insufficient_shadow_cycles", reasons);
  gate(integer(shadow.closed_trade_count ?? 0, "shadow_closed_trade_count") >= gates.minimum_shadow_closed_trades, "insufficient_shadow_closed_trades", reasons);
  gate(finite(shadow.max_drawdown_percent ?? 100, "shadow_max_drawdown_percent") <= gates.maximum_shadow_drawdown_percent, "shadow_drawdown_above_gate", reasons);
  gate(Boolean(input.evidence_integrity_passed), "evidence_integrity_failed", reasons);
  gate(Boolean(input.regime_coverage_passed), "regime_coverage_failed", reasons);

  const historicalQualified = reasons.filter((reason) => !reason.startsWith("insufficient_shadow") && reason !== "shadow_drawdown_above_gate").length === 0;
  const verdict = reasons.length === 0 ? "qualified" : historicalQualified ? "awaiting_forward_evidence" : "rejected";
  return Object.freeze({
    candidate_id: String(input.candidate_id),
    verdict,
    reason_codes: Object.freeze(reasons),
    metrics: Object.freeze({
      window_count: windows.length,
      total_closed_trades: totalTrades,
      positive_test_windows: positiveWindows,
      median_test_return_percent: median(testReturns),
      worst_test_drawdown_percent: Math.max(...drawdowns),
      doubled_cost_median_return_percent: median(doubled),
      tripled_cost_median_return_percent: median(tripled),
      parameter_fragility_percent: fragility,
      shadow_cycle_count: shadow.cycle_count ?? 0,
      shadow_closed_trade_count: shadow.closed_trade_count ?? 0,
      shadow_return_percent: finite(shadow.return_percent ?? 0, "shadow_return_percent"),
      shadow_max_drawdown_percent: finite(shadow.max_drawdown_percent ?? 0, "shadow_max_drawdown_percent"),
    }),
  });
}

export function selectDirectionalPortfolio(verdicts, options = {}) {
  const maxChampion = options.max_champions ?? 1;
  const maxChallengers = options.max_challengers ?? 2;
  const qualified = requireArray(verdicts, "verdicts")
    .filter((row) => row.verdict === "qualified")
    .map((row) => ({ ...row, score: candidateScore(row.metrics) }))
    .sort((a, b) => b.score - a.score || a.candidate_id.localeCompare(b.candidate_id));
  return Object.freeze({
    state: qualified.length ? "portfolio_selected" : "no_qualified_candidates",
    champion_candidate_ids: Object.freeze(qualified.slice(0, maxChampion).map((row) => row.candidate_id)),
    challenger_candidate_ids: Object.freeze(qualified.slice(maxChampion, maxChampion + maxChallengers).map((row) => row.candidate_id)),
    ranking: Object.freeze(qualified.map((row, index) => Object.freeze({ candidate_id: row.candidate_id, rank: index + 1, score: row.score }))),
    cash_is_valid_allocation: true,
  });
}

export function candidateScore(metrics) {
  const returnComponent = finite(metrics.median_test_return_percent, "median_test_return_percent") * 0.35;
  const stressComponent = finite(metrics.doubled_cost_median_return_percent, "doubled_cost_median_return_percent") * 0.2;
  const forwardComponent = finite(metrics.shadow_return_percent, "shadow_return_percent") * 0.25;
  const stabilityPenalty = finite(metrics.worst_test_drawdown_percent, "worst_test_drawdown_percent") * 0.1;
  const fragilityPenalty = finite(metrics.parameter_fragility_percent, "parameter_fragility_percent") * 0.005;
  const forwardDrawdownPenalty = finite(metrics.shadow_max_drawdown_percent, "shadow_max_drawdown_percent") * 0.1;
  return round(returnComponent + stressComponent + forwardComponent - stabilityPenalty - fragilityPenalty - forwardDrawdownPenalty, 12);
}

function assertCandles(candles, minimum) {
  requireArray(candles, "candles");
  if (candles.length < minimum) throw new Error("insufficient_directional_history");
  for (let index = 0; index < candles.length; index += 1) {
    const row = candles[index];
    if (!row || !row.closed_at) throw new Error("invalid_candle");
    if (index > 0) {
      const delta = Date.parse(row.closed_at) - Date.parse(candles[index - 1].closed_at);
      if (delta !== 3600000) throw new Error("non_contiguous_directional_history");
    }
  }
}

function freezeSlice(rows, start, end) {
  return Object.freeze(rows.slice(start, end).map((row) => Object.freeze({ ...row })));
}
function requireArray(value, name) {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`invalid_${name}`);
  return value;
}
function finite(value, name) {
  if (!Number.isFinite(value)) throw new Error(`invalid_${name}`);
  return value;
}
function integer(value, name) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`invalid_${name}`);
  return value;
}
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
function sum(values) { return values.reduce((total, value) => total + value, 0); }
function gate(passed, code, reasons) { if (!passed) reasons.push(code); }
function round(value, places) { const scale = 10 ** places; return Math.round(value * scale) / scale; }
