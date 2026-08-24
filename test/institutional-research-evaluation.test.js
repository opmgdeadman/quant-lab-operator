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

test("EMA pullback trend preregistration is bounded and distinct from continuous EMA exposure", () => {
  const spec = typedSpec({
    strategy: {
      template: "ema_pullback_trend",
      feature_set_id: "close-ema-pullback-v1",
      parameters: { fast: 24, slow: 96, threshold_percent: 1 },
    },
  });
  const validated = validateInstitutionalResearchSpec(spec);
  assert.equal(validated.strategy.template, "ema_pullback_trend");
  assert.equal(validated.strategy.parameters.threshold_percent, 1);
  assert.throws(() => validateInstitutionalResearchSpec(typedSpec({
    strategy: {
      template: "ema_pullback_trend",
      feature_set_id: "close-ema-pullback-v1",
      parameters: { fast: 96, slow: 24, threshold_percent: 1 },
    },
  })), /ema_pullback_fast_must_be_below_slow/);
});

test("ema pullback trend compiles through sealed next-candle walk-forward math", () => {
  const spec = typedSpec({
    strategy: {
      template: "ema_pullback_trend",
      feature_set_id: "close-ema-pullback-v1",
      parameters: { fast: 24, slow: 96, threshold_percent: 1 },
    },
  });
  const policy = buildInstitutionalBacktestPolicy();
  const windows = buildWalkForwardWindows(syntheticCandles(), policy);
  const strategy = buildStrategyFromResearchSpec("typed-ema-pullback-walk-forward-001", spec);
  const result = runDirectionalWalkForward({ windows, strategies: [strategy], policy });
  assert.equal(result.length, 1);
  assert.equal(result[0].windows.length, 5);
  assert.equal(result[0].windows.every((row) => row.execution_model === "next_completed_candle_open"), true);
  assert.equal(result[0].windows.every((row) => row.evidence_integrity_passed === true), true);
  assert.equal(result[0].windows.every((row) => Number.isFinite(row.test_return_percent)), true);
});

test("ema pullback historical signal uses only pre-execution candle state", () => {
  const spec = typedSpec({
    strategy: {
      template: "ema_pullback_trend",
      feature_set_id: "close-ema-pullback-v1",
      parameters: { fast: 24, slow: 96, threshold_percent: 1 },
    },
  });
  const strategy = buildStrategyFromResearchSpec("typed-ema-pullback-no-lookahead-001", spec);
  const rows = syntheticCandles(150);
  const executionIndex = 120;
  const baseline = compileDirectionalSignal(strategy, rows)(executionIndex, 0);
  const mutated = rows.map((row, index) => index === executionIndex
    ? { ...row, open: row.open * 10, high: row.high * 10, low: row.low / 10, close: row.close / 2 }
    : row);
  assert.equal(compileDirectionalSignal(strategy, mutated)(executionIndex, 0), baseline);
});

function closeLocationPressureSpec() {
  return typedSpec({
    strategy: {
      template: "close_location_pressure",
      feature_set_id: "ohlc-close-location-pressure-v1",
      parameters: { period: 12, pressure_threshold: 0.25 },
    },
  });
}

test("close location pressure preregistration is exact and bounded", () => {
  const validated = validateInstitutionalResearchSpec(closeLocationPressureSpec());
  assert.equal(validated.strategy.template, "close_location_pressure");
  assert.deepEqual(validated.strategy.parameters, { period: 12, pressure_threshold: 0.25 });
  assert.throws(() => validateInstitutionalResearchSpec(typedSpec({
    strategy: {
      template: "close_location_pressure",
      feature_set_id: "ohlc-close-location-pressure-v1",
      parameters: { period: 12, pressure_threshold: 1.1 },
    },
  })), /pressure_threshold_out_of_bounds/);
});

test("close location pressure supports both signal paths and excludes the execution candle", () => {
  const start = Date.parse("2026-01-01T00:00:00.000Z");
  const rows = Array.from({ length: 20 }, (_, index) => ({
    closed_at: new Date(start + index * 3600000).toISOString(),
    open: 100,
    high: 110,
    low: 90,
    close: index < 19 ? 108 : 92,
    volume: 100,
  }));
  const strategy = buildStrategyFromResearchSpec("typed-close-location-pressure-001", closeLocationPressureSpec());
  assert.equal(compileDirectionalSignal(strategy, rows)(19, 0), 1);
  const futureMutated = rows.map((row, index) => index === 19 ? { ...row, close: 91 } : row);
  assert.equal(compileDirectionalSignal(strategy, futureMutated)(19, 0), 1);
});

test("close location pressure executes through sealed next-candle walk-forward math", () => {
  const policy = buildInstitutionalBacktestPolicy();
  const windows = buildWalkForwardWindows(syntheticCandles(), policy);
  const strategy = buildStrategyFromResearchSpec("typed-close-location-pressure-walk-forward-001", closeLocationPressureSpec());
  const result = runDirectionalWalkForward({ windows, strategies: [strategy], policy });
  assert.equal(result.length, 1);
  assert.equal(result[0].windows.length, 5);
  assert.equal(result[0].windows.every((row) => row.execution_model === "next_completed_candle_open"), true);
  assert.equal(result[0].windows.every((row) => row.evidence_integrity_passed === true), true);
});

function wickRejectionReversalSpec() {
  return typedSpec({
    strategy: {
      template: "wick_rejection_reversal",
      feature_set_id: "ohlc-wick-rejection-v1",
      parameters: { period: 12, wick_ratio_threshold: 2 },
    },
  });
}

test("wick rejection reversal preregistration is exact and bounded", () => {
  const validated = validateInstitutionalResearchSpec(wickRejectionReversalSpec());
  assert.equal(validated.strategy.template, "wick_rejection_reversal");
  assert.deepEqual(validated.strategy.parameters, { period: 12, wick_ratio_threshold: 2 });
  assert.throws(() => validateInstitutionalResearchSpec(typedSpec({
    strategy: {
      template: "wick_rejection_reversal",
      feature_set_id: "ohlc-wick-rejection-v1",
      parameters: { period: 12, wick_ratio_threshold: 0.5 },
    },
  })), /wick_ratio_threshold_out_of_bounds/);
});

test("wick rejection reversal has symmetric long short signals and explicit zero-body handling", () => {
  const start = Date.parse("2026-01-01T00:00:00.000Z");
  const buildRows = (side) => Array.from({ length: 13 }, (_, index) => {
    const base = {
      closed_at: new Date(start + index * 3600000).toISOString(),
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      volume: 100,
    };
    if (index === 12) return base;
    return side === "lower"
      ? { ...base, high: 100.5, low: 94, close: 100 }
      : { ...base, high: 106, low: 99.5, close: 100 };
  });
  const strategy = buildStrategyFromResearchSpec("typed-wick-rejection-001", wickRejectionReversalSpec());
  assert.equal(compileDirectionalSignal(strategy, buildRows("lower"))(12, 0), 1);
  assert.equal(compileDirectionalSignal(strategy, buildRows("upper"))(12, 0), -1);
});

test("wick rejection reversal excludes execution candle and executes through sealed walk-forward math", () => {
  const rows = syntheticCandles(150);
  const strategy = buildStrategyFromResearchSpec("typed-wick-rejection-no-lookahead-001", wickRejectionReversalSpec());
  const executionIndex = 120;
  const baseline = compileDirectionalSignal(strategy, rows)(executionIndex, 0);
  const mutated = rows.map((row, index) => index === executionIndex
    ? { ...row, open: row.open * 10, high: row.high * 20, low: row.low / 20, close: row.close / 2 }
    : row);
  assert.equal(compileDirectionalSignal(strategy, mutated)(executionIndex, 0), baseline);
  const policy = buildInstitutionalBacktestPolicy();
  const windows = buildWalkForwardWindows(syntheticCandles(), policy);
  const result = runDirectionalWalkForward({ windows, strategies: [strategy], policy });
  assert.equal(result.length, 1);
  assert.equal(result[0].windows.length, 5);
  assert.equal(result[0].windows.every((row) => row.execution_model === "next_completed_candle_open"), true);
  assert.equal(result[0].windows.every((row) => row.evidence_integrity_passed === true), true);
});

function returnAutocorrelationStateSpec() {
  return typedSpec({ strategy: { template: "return_autocorrelation_state", feature_set_id: "close-return-autocorrelation-v1", parameters: { period: 48, autocorr_threshold: 0.15 } } });
}

test("return autocorrelation state preregistration is frozen and bounded", () => {
  const validated = validateInstitutionalResearchSpec(returnAutocorrelationStateSpec());
  assert.deepEqual(validated.strategy.parameters, { period: 48, autocorr_threshold: 0.15 });
  assert.throws(() => validateInstitutionalResearchSpec(typedSpec({ strategy: { template: "return_autocorrelation_state", feature_set_id: "close-return-autocorrelation-v1", parameters: { period: 48, autocorr_threshold: 0 } } })), /autocorr_threshold_out_of_bounds/);
});

test("return autocorrelation state is no-look-ahead and sealed-walk-forward compatible", () => {
  const rows = syntheticCandles(180);
  const strategy = buildStrategyFromResearchSpec("typed-return-autocorr-001", returnAutocorrelationStateSpec());
  const executionIndex = 150;
  const baseline = compileDirectionalSignal(strategy, rows)(executionIndex, 0);
  const mutated = rows.map((row, index) => index === executionIndex ? { ...row, close: row.close * 25 } : row);
  assert.equal(compileDirectionalSignal(strategy, mutated)(executionIndex, 0), baseline);
  const policy = buildInstitutionalBacktestPolicy();
  const windows = buildWalkForwardWindows(syntheticCandles(), policy);
  const result = runDirectionalWalkForward({ windows, strategies: [strategy], policy });
  assert.equal(result[0].windows.length, 5);
  assert.equal(result[0].windows.every((row) => row.evidence_integrity_passed === true), true);
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

function donchianCompressionBreakoutSpec() {
  return typedSpec({
    strategy: {
      template: "donchian_compression_breakout",
      feature_set_id: "ohlc-donchian-compression-v1",
      parameters: { lookback: 72, compression_period: 24, baseline_period: 168 },
    },
  });
}

test("donchian compression breakout preregistration is exact and ordered", () => {
  const validated = validateInstitutionalResearchSpec(donchianCompressionBreakoutSpec());
  assert.equal(validated.strategy.template, "donchian_compression_breakout");
  assert.deepEqual(validated.strategy.parameters, { lookback: 72, compression_period: 24, baseline_period: 168 });
  assert.throws(() => validateInstitutionalResearchSpec(typedSpec({
    strategy: {
      template: "donchian_compression_breakout",
      feature_set_id: "ohlc-donchian-compression-v1",
      parameters: { lookback: 72, compression_period: 72, baseline_period: 168 },
    },
  })), /donchian_compression_period_order_invalid/);
  assert.throws(() => validateInstitutionalResearchSpec(typedSpec({
    strategy: {
      template: "donchian_compression_breakout",
      feature_set_id: "ohlc-donchian-compression-v1",
      parameters: { lookback: 168, compression_period: 24, baseline_period: 168 },
    },
  })), /donchian_compression_period_order_invalid/);
});

test("donchian compression breakout requires pre-break compression and excludes the signal candle", () => {
  const start = Date.parse("2026-01-01T00:00:00.000Z");
  const compressed = Array.from({ length: 170 }, (_, index) => {
    const close = index === 169 ? 111 : 100;
    const older = index < 145;
    return {
      closed_at: new Date(start + index * 3600000).toISOString(),
      open: close,
      high: index === 169 ? 200 : older ? 110 : 100.1,
      low: index === 169 ? 50 : older ? 90 : 99.9,
      close,
      volume: 100,
    };
  });
  const expanded = Array.from({ length: 170 }, (_, index) => {
    const close = index === 169 ? 121 : 100;
    const recent = index >= 145 && index <= 168;
    return {
      closed_at: new Date(start + index * 3600000).toISOString(),
      open: close,
      high: index === 169 ? 200 : recent ? 120 : 101,
      low: index === 169 ? 50 : recent ? 80 : 99,
      close,
      volume: 100,
    };
  });
  const strategy = buildStrategyFromResearchSpec("typed-donchian-compression-test-001", donchianCompressionBreakoutSpec());
  assert.equal(compileDirectionalSignal(strategy, compressed)(compressed.length, 0), 1);
  assert.equal(compileDirectionalSignal(strategy, expanded)(expanded.length, 0), 0);
});

test("donchian compression breakout executes through sealed next-candle walk-forward math", () => {
  const policy = buildInstitutionalBacktestPolicy();
  const windows = buildWalkForwardWindows(syntheticCandles(), policy);
  const strategy = buildStrategyFromResearchSpec("typed-donchian-compression-walk-forward-001", donchianCompressionBreakoutSpec());
  const result = runDirectionalWalkForward({ windows, strategies: [strategy], policy });
  assert.equal(result.length, 1);
  assert.equal(result[0].windows.every((row) => row.execution_model === "next_completed_candle_open"), true);
  assert.equal(result[0].windows.every((row) => row.evidence_integrity_passed === true), true);
});

function dmiAdxTrendSpec() {
  return typedSpec({
    strategy: {
      template: "dmi_adx_trend",
      feature_set_id: "ohlc-dmi-adx-v1",
      parameters: { period: 14, adx_threshold: 25 },
    },
  });
}

function directionalMovementRows(mode, count = 80) {
  const start = Date.parse("2026-01-01T00:00:00.000Z");
  return Array.from({ length: count }, (_, index) => {
    const center = mode === "up" ? 100 + index * 2 : mode === "down" ? 300 - index * 2 : 100;
    return {
      closed_at: new Date(start + index * 3600000).toISOString(),
      open: center,
      high: center + 1,
      low: center - 1,
      close: center,
      volume: 100,
    };
  });
}

test("DMI ADX preregistration is exact and bounded", () => {
  const validated = validateInstitutionalResearchSpec(dmiAdxTrendSpec());
  assert.equal(validated.strategy.template, "dmi_adx_trend");
  assert.deepEqual(validated.strategy.parameters, { period: 14, adx_threshold: 25 });
  assert.throws(() => validateInstitutionalResearchSpec(typedSpec({
    strategy: {
      template: "dmi_adx_trend",
      feature_set_id: "ohlc-dmi-adx-v1",
      parameters: { period: 14, adx_threshold: 5 },
    },
  })), /adx_threshold_out_of_bounds/);
});

test("DMI ADX respects Wilder warmup, directional imbalance, weak trend, and no look-ahead", () => {
  const strategy = buildStrategyFromResearchSpec("typed-dmi-adx-test-001", dmiAdxTrendSpec());
  const warmup = directionalMovementRows("up", 20);
  assert.equal(compileDirectionalSignal(strategy, warmup)(warmup.length, 0), 0);

  const up = directionalMovementRows("up", 81);
  const down = directionalMovementRows("down", 81);
  const flat = directionalMovementRows("flat", 81);
  assert.equal(compileDirectionalSignal(strategy, up)(up.length, 0), 1);
  assert.equal(compileDirectionalSignal(strategy, down)(down.length, 0), -1);
  assert.equal(compileDirectionalSignal(strategy, flat)(flat.length, 0), 0);

  const executionIndex = 80;
  const baselineSignal = compileDirectionalSignal(strategy, up)(executionIndex, 0);
  const futureMutated = up.map((row, index) => index === executionIndex
    ? { ...row, high: row.high * 10, low: row.low / 10, close: row.close / 2 }
    : row);
  assert.equal(compileDirectionalSignal(strategy, futureMutated)(executionIndex, 0), baselineSignal);
});

test("DMI ADX executes only through sealed next-candle walk-forward math", () => {
  const policy = buildInstitutionalBacktestPolicy();
  const windows = buildWalkForwardWindows(syntheticCandles(), policy);
  const strategy = buildStrategyFromResearchSpec("typed-dmi-adx-walk-forward-001", dmiAdxTrendSpec());
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

test("execution research D1 projection includes the fields required by the preregistered comparator", async () => {
  const source = await readFile(new URL("../src/institutionalResearchEvaluation.js", import.meta.url), "utf8");
  assert.match(source, /SELECT id, research_function, lineage_parent_id, preregistration_json, preregistration_hash FROM institutional_hypotheses/);
  assert.match(source, /research_function: row\.research_function/);
  assert.match(source, /lineage_parent_id: row\.lineage_parent_id \|\| null/);
  assert.match(source, /research\.research_function !== "execution_research"/);
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
