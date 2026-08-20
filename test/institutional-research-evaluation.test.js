import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildWalkForwardWindows } from "../src/directionalResearch.js";
import { compileDirectionalSignal, runDirectionalWalkForward } from "../src/directionalBacktest.js";
import {
  INSTITUTIONAL_RESEARCH_SPEC_POLICY,
  validateInstitutionalResearchSpec,
  buildStrategyFromResearchSpec,
  buildInstitutionalBacktestPolicy,
} from "../src/institutionalResearchSpec.js";
import { judgeInstitutionalResearchEvidence } from "../src/institutionalResearchJudge.js";
import { INSTITUTIONAL_RESEARCH_POLICY } from "../src/institutionalResearchPortfolio.js";
import { isInstitutionalForwardExecutionEligible } from "../src/institutionalResearchEvaluation.js";

function typedSpec(overrides = {}) {
  return {
    spec_version: 2,
    dataset_id: "btc-usd-1h-completed-4320-v1",
    strategy: {
      template: "ema_trend",
      feature_set_id: "close-ema-v1",
      parameters: { fast: 12, slow: 36 },
    },
    walk_forward_policy_id: "institutional-walk-forward-v1",
    cost_model_id: "institutional-cost-model-v1",
    judge_policy_id: "institutional-independent-judge-v1",
    evidence_integrity_policy_id: "institutional-evidence-integrity-v1",
    ...overrides,
  };
}

function syntheticCandles(count = 4320) {
  const start = Date.parse("2026-01-01T00:00:00.000Z");
  const rows = [];
  let close = 50000;
  for (let index = 0; index < count; index += 1) {
    const regime = Math.floor(index / 480) % 3;
    const drift = regime === 0 ? 0.0012 : regime === 1 ? -0.001 : 0.00005;
    const wave = Math.sin(index / 11) * 0.0015;
    const open = close;
    close = Math.max(1000, open * (1 + drift + wave));
    const high = Math.max(open, close) * 1.002;
    const low = Math.min(open, close) * 0.998;
    rows.push({
      market: "BTC-USD",
      interval: "1h",
      closed_at: new Date(start + index * 3600000).toISOString(),
      open,
      high,
      low,
      close,
      volume: 100 + (index % 17),
    });
  }
  return rows;
}

function historicalArtifact(overrides = {}) {
  return {
    window_count: 5,
    total_closed_trades: 30,
    positive_test_windows: 4,
    median_test_return_percent: 2.5,
    worst_test_drawdown_percent: 8,
    doubled_cost_median_return_percent: 1.2,
    tripled_cost_median_return_percent: 0.3,
    distinct_traded_regimes: 3,
    evidence_integrity_passed: true,
    execution_model: "next_completed_candle_open",
    caller_supplied_performance_metrics: false,
    ...overrides,
  };
}

test("typed Stage 14 spec rejects unknown templates, mismatched features, rescue fields, and bounds", () => {
  const valid = validateInstitutionalResearchSpec(typedSpec());
  assert.equal(valid.strategy.template, "ema_trend");
  assert.equal(valid.strategy.parameters.fast, 12);
  assert.throws(() => validateInstitutionalResearchSpec(typedSpec({
    strategy: { template: "magic_model", feature_set_id: "close-ema-v1", parameters: { fast: 12, slow: 36 } },
  })), /strategy_template_not_allowed/);
  assert.throws(() => validateInstitutionalResearchSpec(typedSpec({
    strategy: { template: "ema_trend", feature_set_id: "close-rsi-v1", parameters: { fast: 12, slow: 36 } },
  })), /feature_set_not_allowed/);
  assert.throws(() => validateInstitutionalResearchSpec(typedSpec({
    strategy: { template: "ema_trend", feature_set_id: "close-ema-v1", parameters: { fast: 50, slow: 20 } },
  })), /ema_fast_must_be_below_slow/);
  assert.throws(() => validateInstitutionalResearchSpec({ ...typedSpec(), performance_metrics: { return_percent: 999 } }), /research_spec_shape_invalid/);
  assert.throws(() => validateInstitutionalResearchSpec(typedSpec({
    strategy: { template: "price_momentum", feature_set_id: "close-momentum-v1", parameters: { lookback: 24, threshold_percent: 99 } },
  })), /threshold_percent_out_of_bounds/);
});

function donchianRegimeBreakoutSpec() {
  return typedSpec({
    strategy: {
      template: "donchian_regime_breakout",
      feature_set_id: "ohlc-donchian-regime-v1",
      parameters: { lookback: 72, regime_lookback: 168 },
    },
  });
}

test("donchian regime breakout preregistration is distinct and bounded", () => {
  const validated = validateInstitutionalResearchSpec(donchianRegimeBreakoutSpec());
  assert.equal(validated.strategy.template, "donchian_regime_breakout");
  assert.equal(validated.strategy.parameters.lookback, 72);
  assert.equal(validated.strategy.parameters.regime_lookback, 168);
  assert.throws(() => validateInstitutionalResearchSpec(typedSpec({
    strategy: {
      template: "donchian_regime_breakout",
      feature_set_id: "ohlc-donchian-regime-v1",
      parameters: { lookback: 168, regime_lookback: 72 },
    },
  })), /donchian_regime_lookback_order_invalid/);
});

test("donchian regime breakout requires directional regime agreement", () => {
  const buildRows = (mode) => Array.from({ length: 170 }, (_, index) => {
    let close = mode === "aligned" ? 100 + index * 0.5 : 200 - index * 0.5;
    if (mode === "mismatch" && index === 169) close = 150;
    return {
      closed_at: new Date(Date.parse("2026-01-01T00:00:00.000Z") + index * 3600000).toISOString(),
      open: close,
      high: close * 1.001,
      low: close * 0.999,
      close,
      volume: 100,
    };
  });
  const strategy = buildStrategyFromResearchSpec("typed-donchian-regime-test-001", donchianRegimeBreakoutSpec());
  const alignedRows = buildRows("aligned");
  const mismatchedRows = buildRows("mismatch");
  assert.equal(compileDirectionalSignal(strategy, alignedRows)(alignedRows.length, 0), 1);
  assert.equal(compileDirectionalSignal(strategy, mismatchedRows)(mismatchedRows.length, 0), 0);
});

test("donchian regime breakout executes through sealed next-candle walk-forward math", () => {
  const policy = buildInstitutionalBacktestPolicy();
  const windows = buildWalkForwardWindows(syntheticCandles(), policy);
  const strategy = buildStrategyFromResearchSpec("typed-donchian-regime-walk-forward-001", donchianRegimeBreakoutSpec());
  const result = runDirectionalWalkForward({ windows, strategies: [strategy], policy });
  assert.equal(result.length, 1);
  assert.equal(result[0].windows.every((row) => row.execution_model === "next_completed_candle_open"), true);
  assert.equal(result[0].windows.every((row) => row.evidence_integrity_passed === true), true);
});

function regimeMomentumSpec() {
  return typedSpec({
    strategy: {
      template: "regime_momentum",
      feature_set_id: "close-regime-momentum-v1",
      parameters: { lookback: 24, regime_lookback: 168, threshold_percent: 0.5 },
    },
  });
}

test("regime momentum preregistration is distinct, bounded, and long-regime filtered", () => {
  const validated = validateInstitutionalResearchSpec(regimeMomentumSpec());
  assert.equal(validated.strategy.template, "regime_momentum");
  assert.equal(validated.strategy.parameters.regime_lookback, 168);
  assert.throws(() => validateInstitutionalResearchSpec(typedSpec({
    strategy: {
      template: "regime_momentum",
      feature_set_id: "close-regime-momentum-v1",
      parameters: { lookback: 48, regime_lookback: 24, threshold_percent: 0.5 },
    },
  })), /regime_momentum_lookback_order_invalid/);
});

test("regime momentum executes through sealed next-candle walk-forward math", () => {
  const policy = buildInstitutionalBacktestPolicy();
  const windows = buildWalkForwardWindows(syntheticCandles(), policy);
  const strategy = buildStrategyFromResearchSpec("typed-regime-momentum-test-001", regimeMomentumSpec());
  const result = runDirectionalWalkForward({ windows, strategies: [strategy], policy });
  assert.equal(result.length, 1);
  assert.equal(result[0].windows.every((row) => row.evidence_integrity_passed === true), true);
  assert.equal(result[0].windows.every((row) => Number.isFinite(row.test_return_percent)), true);
});

function volatilityRegimeBreakoutSpec() {
  return typedSpec({
    strategy: {
      template: "volatility_regime_breakout",
      feature_set_id: "ohlc-true-range-regime-v1",
      parameters: { period: 20, regime_period: 80, multiplier: 2 },
    },
  });
}

test("volatility regime breakout preregistration is distinct and bounded", () => {
  const validated = validateInstitutionalResearchSpec(volatilityRegimeBreakoutSpec());
  assert.equal(validated.strategy.template, "volatility_regime_breakout");
  assert.equal(validated.strategy.parameters.regime_period, 80);
  assert.throws(() => validateInstitutionalResearchSpec(typedSpec({
    strategy: {
      template: "volatility_regime_breakout",
      feature_set_id: "ohlc-true-range-regime-v1",
      parameters: { period: 80, regime_period: 40, multiplier: 2 },
    },
  })), /volatility_regime_period_order_invalid/);
});

test("volatility regime breakout executes through sealed next-candle walk-forward math", () => {
  const policy = buildInstitutionalBacktestPolicy();
  const windows = buildWalkForwardWindows(syntheticCandles(), policy);
  const strategy = buildStrategyFromResearchSpec("typed-volatility-regime-test-001", volatilityRegimeBreakoutSpec());
  const result = runDirectionalWalkForward({ windows, strategies: [strategy], policy });
  assert.equal(result.length, 1);
  assert.equal(result[0].windows.every((row) => row.execution_model === "next_completed_candle_open"), true);
  assert.equal(result[0].windows.every((row) => row.evidence_integrity_passed === true), true);
});

test("typed Stage 14 strategy executes only through proven next-candle walk-forward math", () => {
  const spec = typedSpec();
  const policy = buildInstitutionalBacktestPolicy();
  assert.equal(policy.required_candles, 4320);
  const windows = buildWalkForwardWindows(syntheticCandles(), policy);
  assert.equal(windows.length, 5);
  const strategy = buildStrategyFromResearchSpec("typed-ema-test-001", spec);
  const result = runDirectionalWalkForward({ windows, strategies: [strategy], policy });
  assert.equal(result.length, 1);
  assert.equal(result[0].windows.length, 5);
  assert.equal(result[0].windows.every((row) => row.execution_model === "next_completed_candle_open"), true);
  assert.equal(result[0].windows.every((row) => row.evidence_integrity_passed === true), true);
  assert.equal(result[0].windows.every((row) => Number.isFinite(row.test_return_percent)), true);
});

test("Stage 14 lifecycle ordering is source-enforced independent of current ECL prose", async () => {
  assert.deepEqual(INSTITUTIONAL_RESEARCH_POLICY.transitions.proposed, ["admitted", "rejected", "retired"]);
  assert.deepEqual(INSTITUTIONAL_RESEARCH_POLICY.transitions.admitted, ["testing", "rejected", "retired"]);
  assert.deepEqual(INSTITUTIONAL_RESEARCH_POLICY.transitions.testing, ["rejected", "qualified", "retired"]);
  assert.deepEqual(INSTITUTIONAL_RESEARCH_POLICY.transitions.rejected, []);

  const source = await readFile(new URL("../src/institutionalResearchEvaluation.js", import.meta.url), "utf8");
  assert.match(source, /\["admitted", "testing"\]\.includes\(hypothesis\.state\)/, "sealed evaluation must reject proposed hypotheses");
  assert.match(source, /\["testing", "qualified", "rejected"\]\.includes\(hypothesis\.state\)/, "independent judge must reject admitted hypotheses");
  assert.match(source, /institutional_judge_sealed_evaluation_missing/, "independent judge must require sealed evaluation evidence");
});

test("independent judge rejects weak sealed historical evidence", () => {
  const result = judgeInstitutionalResearchEvidence({
    artifact: historicalArtifact({ median_test_return_percent: -1, positive_test_windows: 1 }),
    forwardEvidence: { cycle_count: 999, closed_trade_count: 99, return_percent: 20, max_drawdown_percent: 1, evidence_integrity_passed: true },
  });
  assert.equal(result.verdict, "rejected");
  assert.ok(result.reason_codes.includes("median_test_return_below_gate"));
  assert.ok(result.reason_codes.includes("insufficient_positive_test_windows"));
  assert.equal(result.stage13_promotion_authority_changed, false);
});

test("independent judge requires forward evidence after historical qualification", () => {
  const result = judgeInstitutionalResearchEvidence({ artifact: historicalArtifact(), forwardEvidence: null });
  assert.equal(result.verdict, "awaiting_forward_evidence");
  assert.ok(result.reason_codes.includes("insufficient_forward_cycles"));
  assert.ok(result.reason_codes.includes("forward_evidence_integrity_failed"));
});

test("independent judge qualifies only when sealed historical and forward gates both pass", () => {
  const result = judgeInstitutionalResearchEvidence({
    artifact: historicalArtifact(),
    forwardEvidence: { cycle_count: 200, closed_trade_count: 7, return_percent: 3.1, max_drawdown_percent: 5, evidence_integrity_passed: true },
  });
  assert.equal(result.verdict, "qualified");
  assert.deepEqual(result.reason_codes, []);
  assert.equal(result.paper_only, true);
  assert.equal(result.live_capital_enabled, false);
  assert.equal(result.stage13_promotion_authority_changed, false);
});

test("independent judge rejects caller-supplied performance-metric artifacts", () => {
  assert.throws(() => judgeInstitutionalResearchEvidence({
    artifact: historicalArtifact({ caller_supplied_performance_metrics: true }),
    forwardEvidence: { cycle_count: 200, closed_trade_count: 7, return_percent: 3.1, max_drawdown_percent: 5, evidence_integrity_passed: true },
  }), /caller_metrics_flag_invalid/);
});

test("Stage 14 forward evidence begins only after testing and on the next completed candle", () => {
  assert.equal(isInstitutionalForwardExecutionEligible({ testingStartedAt: "2026-08-19T20:27:47.457Z", signalClosedAt: "2026-08-19T20:00:00.000Z", executionClosedAt: "2026-08-19T21:00:00.000Z" }), false);
  assert.equal(isInstitutionalForwardExecutionEligible({ testingStartedAt: "2026-08-19T20:27:47.457Z", signalClosedAt: "2026-08-19T21:00:00.000Z", executionClosedAt: "2026-08-19T22:00:00.000Z" }), true);
  assert.equal(isInstitutionalForwardExecutionEligible({ testingStartedAt: "2026-08-19T20:27:47.457Z", signalClosedAt: "2026-08-19T21:00:00.000Z", executionClosedAt: "2026-08-19T21:00:00.000Z" }), false);
});

test("0020 adds only a mutable forward projection while evidence remains immutable", async () => {
  const sql = await readFile(new URL("../migrations/0020_institutional_research_forward_portfolio.sql", import.meta.url), "utf8");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS institutional_research_forward_portfolios/);
  assert.match(sql, /testing_started_at TEXT NOT NULL/);
  assert.match(sql, /closed_trade_count INTEGER NOT NULL/);
  assert.doesNotMatch(sql, /UPDATE ON institutional_research_forward_evidence/);
});

test("hourly production operation wires Stage 14 forward collection", async () => {
  const source = await readFile(new URL("../src/index.js", import.meta.url), "utf8");
  assert.match(source, /runScheduledInstitutionalResearchForwardEvidence/);
  assert.match(source, /institutionalForward/);
  const evaluationSource = await readFile(new URL("../src/institutionalResearchEvaluation.js", import.meta.url), "utf8");
  assert.match(evaluationSource, /forward_evidence_count/);
  assert.match(evaluationSource, /forward_portfolio/);
});

test("0019 seals evaluation, forward evidence, and verdict tables against mutation", async () => {
  const sql = await readFile(new URL("../migrations/0019_institutional_research_evaluation.sql", import.meta.url), "utf8");
  for (const table of ["institutional_research_evaluations", "institutional_research_forward_evidence", "institutional_research_verdicts"]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  for (const marker of ["institutional_research_evaluation_immutable", "institutional_research_forward_evidence_immutable", "institutional_research_verdict_immutable"]) {
    assert.match(sql, new RegExp(marker));
  }
  assert.match(sql, /hypothesis_id TEXT NOT NULL UNIQUE/);
  assert.match(sql, /UNIQUE\(hypothesis_id, evidence_hash\)/);
});

test("Stage 14 spec policy fixes dataset, costs, execution and caller metric boundary", () => {
  assert.equal(INSTITUTIONAL_RESEARCH_SPEC_POLICY.dataset.required_contiguous_candles, 4320);
  assert.equal(INSTITUTIONAL_RESEARCH_SPEC_POLICY.cost_model.fee_bps, 10);
  assert.equal(INSTITUTIONAL_RESEARCH_SPEC_POLICY.cost_model.slippage_bps, 5);
  assert.equal(INSTITUTIONAL_RESEARCH_SPEC_POLICY.cost_model.short_carry_bps_per_day, 3);
  assert.equal(INSTITUTIONAL_RESEARCH_SPEC_POLICY.cost_model.execution, "next_completed_candle_open");
  assert.equal(INSTITUTIONAL_RESEARCH_SPEC_POLICY.evidence_integrity.caller_supplied_performance_metrics_allowed, false);
});
