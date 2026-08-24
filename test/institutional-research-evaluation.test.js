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
import { institutionalForwardElapsedHours, isInstitutionalForwardExecutionEligible } from "../src/institutionalResearchEvaluation.js";
import { directionalSignal } from "../src/directionalShadow.js";

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

test("directional crowding reversal preregistration, exact boundaries, zero denominator behavior, parity, and no-look-ahead", () => {
  const spec = typedSpec({ strategy: { template: "directional_crowding_reversal", feature_set_id: "close-directional-crowding-v1", parameters: { period: 48, upper_fraction: 0.7, lower_fraction: 0.3 } } });
  const valid = validateInstitutionalResearchSpec(spec);
  assert.deepEqual(valid.strategy.parameters, { period: 48, upper_fraction: 0.7, lower_fraction: 0.3 });

  const strategy = { id: "crowding-test", family: "directional_crowding_reversal", market: "BTC-USD", interval: "1h", parameters: { period: 10, upper_fraction: 0.7, lower_fraction: 0.3 } };
  const makeRows = (moves) => {
    let close = 100;
    const closes = [close];
    for (const move of moves) { close += move; closes.push(close); }
    return closes.map((value, index) => ({ market: "BTC-USD", interval: "1h", closed_at: new Date(Date.parse("2026-03-01T00:00:00.000Z") + index * 3600000).toISOString(), open: value, high: value, low: value, close: value, volume: 1 }));
  };
  const high = makeRows([1,1,1,1,1,1,1,-1,-1,-1]);
  const low = makeRows([-1,-1,-1,-1,-1,-1,-1,1,1,1]);
  const flat = makeRows([1,1,1,1,1,-1,-1,-1,-1,-1]);
  const zeros = makeRows([1,1,1,0,0,0,0,-1,-1,-1]);
  assert.equal(compileDirectionalSignal(strategy, high)(11, 0), -1);
  assert.equal(directionalSignal(strategy, high, 0).target_exposure, -1);
  assert.equal(compileDirectionalSignal(strategy, low)(11, 0), 1);
  assert.equal(directionalSignal(strategy, low, 0).target_exposure, 1);
  assert.equal(compileDirectionalSignal(strategy, flat)(11, 0), 0);
  assert.equal(directionalSignal(strategy, flat, 0).target_exposure, 0);
  assert.equal(compileDirectionalSignal(strategy, zeros)(11, 0), 1);
  assert.equal(directionalSignal(strategy, zeros, 0).target_exposure, 1);
  const futureChanged = high.map((row) => ({ ...row }));
  futureChanged[10] = { ...futureChanged[10], open: 1000, high: 1000, low: 1000, close: 1000 };
  assert.equal(compileDirectionalSignal(strategy, futureChanged)(10, 0), compileDirectionalSignal(strategy, high)(10, 0));
});

test("rolling drawdown reversion preregistration, boundary, long-only parity, and no-look-ahead", () => {
  const spec = typedSpec({ strategy: { template: "rolling_drawdown_reversion", feature_set_id: "close-rolling-drawdown-v1", parameters: { period: 72, threshold_percent: 5 } } });
  const valid = validateInstitutionalResearchSpec(spec);
  assert.deepEqual(valid.strategy.parameters, { period: 72, threshold_percent: 5 });

  const strategy = { id: "drawdown-test", family: "rolling_drawdown_reversion", market: "BTC-USD", interval: "1h", parameters: { period: 4, threshold_percent: 5 } };
  const rows = [100, 100, 100, 95, 94].map((close, index) => ({ market: "BTC-USD", interval: "1h", closed_at: new Date(Date.parse("2026-01-01T00:00:00.000Z") + index * 3600000).toISOString(), open: close, high: close, low: close, close, volume: 1 }));
  const compile = compileDirectionalSignal(strategy, rows);
  assert.equal(compile(4, 0), 1);
  assert.equal(directionalSignal(strategy, rows.slice(0, 4), 0).target_exposure, 1);
  assert.equal(compile(3, -1), -1);
  assert.equal(directionalSignal(strategy, rows.slice(0, 3), -1).target_exposure, -1);
  assert.equal(compile(5, 0), 1);
  assert.equal(directionalSignal(strategy, rows, 0).target_exposure, 1);
  const futureChanged = rows.map((row) => ({ ...row }));
  futureChanged[4].close = 1000;
  futureChanged[4].open = 1000;
  futureChanged[4].high = 1000;
  futureChanged[4].low = 1000;
  assert.equal(compileDirectionalSignal(strategy, futureChanged)(4, 0), 1);
  const interior = [100, 100, 100, 96].map((close, index) => ({ market: "BTC-USD", interval: "1h", closed_at: new Date(Date.parse("2026-02-01T00:00:00.000Z") + index * 3600000).toISOString(), open: close, high: close, low: close, close, volume: 1 }));
  assert.equal(compileDirectionalSignal(strategy, interior)(4, 0), 0);
  assert.equal(directionalSignal(strategy, interior, 0).target_exposure, 0);
});

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

function rangePositionStrategy(parameters = { period: 4, lower: 20, upper: 80 }) {
  return { id: "range-position-test", family: "range_position_state", market: "BTC-USD", interval: "1h", parameters };
}

function rangePositionRows(closes, lows = [], highs = []) {
  return closes.map((close, index) => ({
    market: "BTC-USD", interval: "1h",
    closed_at: new Date(Date.parse("2026-01-01T00:00:00.000Z") + index * 3600000).toISOString(),
    open: close,
    high: highs[index] ?? Math.max(close, 100),
    low: lows[index] ?? Math.min(close, 0),
    close,
    volume: 1,
  }));
}

test("range position preregistration, exact boundaries, parity, zero-range, and no-look-ahead", () => {
  const validated = validateInstitutionalResearchSpec(typedSpec({ strategy: { template: "range_position_state", feature_set_id: "ohlc-range-position-v1", parameters: { period: 48, lower: 20, upper: 80 } } }));
  assert.deepEqual(validated.strategy.parameters, { period: 48, lower: 20, upper: 80 });
  assert.throws(() => validateInstitutionalResearchSpec(typedSpec({ strategy: { template: "range_position_state", feature_set_id: "ohlc-range-position-v1", parameters: { period: 48, lower: 80, upper: 20 } } })), /range_position_order_invalid|lower_out_of_bounds/);

  const strategy = rangePositionStrategy();
  for (const [latest, expected] of [[81, 1], [21, -1], [51, 0]]) {
    const rows = rangePositionRows([51, 51, 51, latest], [1, 1, 1, 1], [101, 101, 101, 101]);
    assert.equal(compileDirectionalSignal(strategy, rows)(4, 0), expected);
    assert.equal(directionalSignal(strategy, rows, 0).target_exposure, expected);
  }

  const flat = rangePositionRows([50, 50, 50, 50], [50, 50, 50, 50], [50, 50, 50, 50]);
  assert.equal(compileDirectionalSignal(strategy, flat)(4, 0), 0);
  assert.equal(directionalSignal(strategy, flat, 0).target_exposure, 0);

  const history = rangePositionRows([51, 51, 51, 81, 2], [1, 1, 1, 1, 1], [101, 101, 101, 101, 101]);
  const compiled = compileDirectionalSignal(strategy, history);
  assert.equal(compiled(4, 0), 1);
  history[4] = { ...history[4], low: 0.01, high: 999999, close: 999999 };
  assert.equal(compiled(4, 0), 1);
});

function returnZscoreStrategy(parameters = { period: 4, z_threshold: 2 }) {
  return { id: "return-zscore-test", family: "return_zscore_reversal", market: "BTC-USD", interval: "1h", parameters };
}

function returnZscoreRows(returns) {
  const closes = [100];
  for (const value of returns) closes.push(closes.at(-1) * (1 + value));
  return closes.map((close, index) => ({ market: "BTC-USD", interval: "1h", closed_at: new Date(Date.parse("2026-01-01T00:00:00.000Z") + index * 3600000).toISOString(), open: close, high: close * 1.001, low: close * 0.999, close, volume: 1 }));
}

test("return z-score preregistration, zero dispersion, parity, boundary direction, and no-look-ahead", () => {
  const validated = validateInstitutionalResearchSpec(typedSpec({ strategy: { template: "return_zscore_reversal", feature_set_id: "close-return-zscore-reversal-v1", parameters: { period: 48, z_threshold: 2 } } }));
  assert.deepEqual(validated.strategy.parameters, { period: 48, z_threshold: 2 });
  const strategy = returnZscoreStrategy();
  const zero = returnZscoreRows([0, 0, 0, 0, 0]);
  assert.equal(compileDirectionalSignal(strategy, zero)(5, 0), 0);
  const prior = [-0.01, 0.01, -0.01, 0.01];
  const sd = Math.sqrt(0.0004 / 3);
  for (const [latest, expected] of [[2 * sd, -1], [-2 * sd, 1], [0, 0]]) {
    const rows = returnZscoreRows([...prior, latest, 0]);
    assert.equal(compileDirectionalSignal(strategy, rows)(6, 0), expected);
    assert.equal(directionalSignal(strategy, rows.slice(0, 6), 0).target_exposure, expected);
    const compiled = compileDirectionalSignal(strategy, rows);
    const before = compiled(6, 0);
    rows[6] = { ...rows[6], close: rows[6].close * 10, high: rows[6].high * 10, low: rows[6].low * 10 };
    assert.equal(compiled(6, 0), before);
  }
});

function efficiencyRatioStrategy(parameters = { period: 4, efficiency_threshold: 0.35 }) {
  return { id: "efficiency-test", family: "efficiency_ratio_trend", market: "BTC-USD", interval: "1h", parameters };
}

function efficiencyRows(closes) {
  return closes.map((close, index) => ({ market: "BTC-USD", interval: "1h", closed_at: new Date(Date.parse("2026-01-01T00:00:00.000Z") + index * 3600000).toISOString(), open: close, high: close + 1, low: Math.max(0.01, close - 1), close, volume: 1 }));
}

test("efficiency ratio gate 1 preregistration bounds", () => {
  const spec = typedSpec({ strategy: { template: "efficiency_ratio_trend", feature_set_id: "close-efficiency-ratio-v1", parameters: { period: 24, efficiency_threshold: 0.35 } } });
  const validated = validateInstitutionalResearchSpec(spec);
  assert.deepEqual(validated.strategy.parameters, { period: 24, efficiency_threshold: 0.35 });
  assert.throws(() => validateInstitutionalResearchSpec(typedSpec({ strategy: { template: "efficiency_ratio_trend", feature_set_id: "close-efficiency-ratio-v1", parameters: { period: 3, efficiency_threshold: 0.35 } } })), /period_out_of_bounds/);
});

test("efficiency ratio gate 2 directional parity", () => {
  const strategy = efficiencyRatioStrategy();
  for (const [closes, expected] of [
    [[100, 101, 102, 103, 104, 999], 1],
    [[104, 103, 102, 101, 100, 1], -1],
  ]) {
    const rows = efficiencyRows(closes);
    assert.equal(compileDirectionalSignal(strategy, rows)(5, 0), expected);
    assert.equal(directionalSignal(strategy, rows.slice(0, 5), 0).target_exposure, expected);
  }
});

test("efficiency ratio gate 3 noisy and zero-path flat", () => {
  const strategy = efficiencyRatioStrategy();
  for (const closes of [[100, 110, 100, 110, 100, 999], [100, 100, 100, 100, 100, 999]]) {
    const rows = efficiencyRows(closes);
    assert.equal(compileDirectionalSignal(strategy, rows)(5, 0), 0);
    assert.equal(directionalSignal(strategy, rows.slice(0, 5), 0).target_exposure, 0);
  }
});

test("efficiency ratio gate 4 exact threshold and no look-ahead", () => {
  const rows = efficiencyRows([100, 107, 100, 107, 107, 999]);
  const threshold = 7 / 21;
  const strategy = efficiencyRatioStrategy({ period: 4, efficiency_threshold: threshold });
  const baseline = compileDirectionalSignal(strategy, rows)(5, 0);
  assert.equal(baseline, 1);
  assert.equal(directionalSignal(strategy, rows.slice(0, 5), 0).target_exposure, 1);
  const mutated = rows.map((row, index) => index === 5 ? { ...row, open: 1, high: 1000000, low: 0.01, close: 1 } : row);
  assert.equal(compileDirectionalSignal(strategy, mutated)(5, 0), baseline);
});

function returnAccelerationSpec(parameters = { period: 12, acceleration_threshold_percent: 1.0 }) {
  return typedSpec({ strategy: { template: "return_acceleration_state", feature_set_id: "close-return-acceleration-v1", parameters } });
}

test("return acceleration spec is frozen and bounded", () => {
  const validated = validateInstitutionalResearchSpec(returnAccelerationSpec());
  assert.deepEqual(validated.strategy.parameters, { period: 12, acceleration_threshold_percent: 1.0 });
  assert.throws(() => validateInstitutionalResearchSpec(returnAccelerationSpec({ period: 3, acceleration_threshold_percent: 1.0 })), /period_out_of_bounds/);
});

test("return acceleration historical and forward paths agree at long short flat and exact threshold", () => {
  const strategy = buildStrategyFromResearchSpec("typed-return-acceleration-001", returnAccelerationSpec());
  const build = (a, b, c) => quantileRows([...Array(12).fill(a), ...Array(12).fill(b), c]);
  for (const [rows, expected] of [[build(100, 100, 101), 1], [build(100, 100, 99), -1], [build(100, 100, 100.5), 0]]) {
    assert.equal(compileDirectionalSignal(strategy, rows)(25, 0), expected);
    assert.equal(directionalSignal(strategy, rows.slice(0, 25), 0).target_exposure, expected);
  }
});

test("return acceleration excludes execution candle and requires full two-window history", () => {
  const strategy = buildStrategyFromResearchSpec("typed-return-acceleration-no-lookahead-001", returnAccelerationSpec());
  const rows = quantileRows([...Array(12).fill(100), ...Array(12).fill(100), 101, 999]);
  assert.equal(compileDirectionalSignal(strategy, rows)(24, -1), -1);
  const baseline = compileDirectionalSignal(strategy, rows)(25, 0);
  assert.equal(baseline, 1);
  const mutated = rows.map((row, index) => index === 25 ? { ...row, open: 1, high: 2, low: 0.5, close: 1 } : row);
  assert.equal(compileDirectionalSignal(strategy, mutated)(25, 0), baseline);
  assert.equal(directionalSignal(strategy, rows.slice(0, 25), 0).target_exposure, baseline);
});

function closeQuantileReversionSpec(parameters = { period: 72, lower_quantile: 0.10, upper_quantile: 0.90 }) {
  return typedSpec({ strategy: { template: "close_quantile_reversion", feature_set_id: "close-quantile-rank-v1", parameters } });
}

function quantileRows(closes) {
  const start = Date.parse("2026-01-01T00:00:00.000Z");
  return closes.map((close, index) => ({ closed_at: new Date(start + index * 3600000).toISOString(), open: close, high: close + 1, low: Math.max(0.01, close - 1), close, volume: 100 }));
}

test("close quantile reversion preregistration is exact, ordered, and bounded", () => {
  const validated = validateInstitutionalResearchSpec(closeQuantileReversionSpec());
  assert.deepEqual(validated.strategy.parameters, { period: 72, lower_quantile: 0.10, upper_quantile: 0.90 });
  assert.throws(() => validateInstitutionalResearchSpec(closeQuantileReversionSpec({ period: 72, lower_quantile: 0.90, upper_quantile: 0.10 })), /lower_quantile_out_of_bounds|upper_quantile_out_of_bounds|close_quantile_order_invalid/);
  assert.throws(() => validateInstitutionalResearchSpec(closeQuantileReversionSpec({ period: 11, lower_quantile: 0.10, upper_quantile: 0.90 })), /period_out_of_bounds/);
});

test("close quantile reversion has symmetric tails, deterministic ties, and historical-forward parity", () => {
  const strategy = buildStrategyFromResearchSpec("typed-close-quantile-001", closeQuantileReversionSpec());
  const upper = quantileRows([...Array.from({ length: 71 }, (_, index) => index + 1), 1000]);
  const lower = quantileRows([...Array.from({ length: 71 }, (_, index) => index + 2), 1]);
  const tied = quantileRows(Array(72).fill(100));
  for (const [rows, expected] of [[upper, -1], [lower, 1], [tied, 0]]) {
    assert.equal(compileDirectionalSignal(strategy, rows)(72, 0), expected);
    assert.equal(directionalSignal(strategy, rows, 0).target_exposure, expected);
  }
});

test("close quantile reversion includes exact attainable rank boundaries", () => {
  const lowerRank = 7.5 / 72;
  const upperRank = 64.5 / 72;
  const strategy = buildStrategyFromResearchSpec("typed-close-quantile-boundary-001", closeQuantileReversionSpec({ period: 72, lower_quantile: lowerRank, upper_quantile: upperRank }));
  const lowerCloses = [...Array.from({ length: 7 }, (_, index) => index + 1), ...Array.from({ length: 64 }, (_, index) => index + 9), 8];
  const upperCloses = [...Array.from({ length: 64 }, (_, index) => index + 1), ...Array.from({ length: 7 }, (_, index) => index + 66), 65];
  assert.equal(compileDirectionalSignal(strategy, quantileRows(lowerCloses))(72, 0), 1);
  assert.equal(directionalSignal(strategy, quantileRows(lowerCloses), 0).target_exposure, 1);
  assert.equal(compileDirectionalSignal(strategy, quantileRows(upperCloses))(72, 0), -1);
  assert.equal(directionalSignal(strategy, quantileRows(upperCloses), 0).target_exposure, -1);
});

test("close quantile reversion preserves minimum-history state and excludes execution candle", () => {
  const strategy = buildStrategyFromResearchSpec("typed-close-quantile-no-lookahead-001", closeQuantileReversionSpec());
  const signalRows = quantileRows([...Array.from({ length: 71 }, (_, index) => index + 1), 1000]);
  assert.equal(compileDirectionalSignal(strategy, signalRows.slice(0, 71))(71, 1), 1);
  const execution = { ...signalRows.at(-1), closed_at: new Date(Date.parse(signalRows.at(-1).closed_at) + 3600000).toISOString(), open: 5000, high: 6000, low: 4000, close: 5500 };
  const rows = [...signalRows, execution];
  const baseline = compileDirectionalSignal(strategy, rows)(72, 0);
  assert.equal(baseline, -1);
  const mutated = rows.map((row, index) => index === 72 ? { ...row, open: 1, high: 2, low: 0.5, close: 1 } : row);
  assert.equal(compileDirectionalSignal(strategy, mutated)(72, 0), baseline);
  assert.equal(directionalSignal(strategy, signalRows, 0).target_exposure, baseline);
});

test("close quantile reversion executes only through sealed next-completed-candle walk-forward math", () => {
  const policy = buildInstitutionalBacktestPolicy();
  const windows = buildWalkForwardWindows(syntheticCandles(), policy);
  const strategy = buildStrategyFromResearchSpec("typed-close-quantile-walk-forward-001", closeQuantileReversionSpec());
  const result = runDirectionalWalkForward({ windows, strategies: [strategy], policy });
  assert.equal(result.length, 1);
  assert.equal(result[0].windows.length, 5);
  assert.equal(result[0].windows.every((row) => row.execution_model === "next_completed_candle_open"), true);
  assert.equal(result[0].windows.every((row) => row.evidence_integrity_passed === true), true);
});

function rollingMedianReversionSpec() {
  return typedSpec({ strategy: { template: "rolling_median_reversion", feature_set_id: "close-rolling-median-deviation-v1", parameters: { period: 48, threshold_percent: 2.0 } } });
}

function medianFixture(signalClose) {
  const start = Date.parse("2026-01-01T00:00:00.000Z");
  const closes = Array(48).fill(100);
  closes[47] = signalClose;
  return closes.map((close, index) => ({ closed_at: new Date(start + index * 3600000).toISOString(), open: close, high: close + 1, low: close - 1, close, volume: 100 }));
}

test("rolling median reversion preregistration is exact and bounded", () => {
  const validated = validateInstitutionalResearchSpec(rollingMedianReversionSpec());
  assert.deepEqual(validated.strategy.parameters, { period: 48, threshold_percent: 2.0 });
  assert.throws(() => validateInstitutionalResearchSpec(typedSpec({ strategy: { template: "rolling_median_reversion", feature_set_id: "close-rolling-median-deviation-v1", parameters: { period: 11, threshold_percent: 2.0 } } })), /period_out_of_bounds/);
  assert.throws(() => validateInstitutionalResearchSpec(typedSpec({ strategy: { template: "rolling_median_reversion", feature_set_id: "close-rolling-median-deviation-v1", parameters: { period: 48, threshold_percent: 0.1 } } })), /threshold_percent_out_of_bounds/);
});

test("rolling median reversion computes even median and symmetric displacement signals", () => {
  const strategy = buildStrategyFromResearchSpec("typed-median-reversion-001", rollingMedianReversionSpec());
  const above = medianFixture(102);
  const below = medianFixture(98);
  assert.equal(compileDirectionalSignal(strategy, above)(48, 0), -1);
  assert.equal(directionalSignal(strategy, above, 0).target_exposure, -1);
  assert.equal(compileDirectionalSignal(strategy, below)(48, 0), 1);
  assert.equal(directionalSignal(strategy, below, 0).target_exposure, 1);
});

test("rolling median reversion stays flat inside threshold and preserves exact boundaries", () => {
  const strategy = buildStrategyFromResearchSpec("typed-median-reversion-boundary-001", rollingMedianReversionSpec());
  const inside = medianFixture(101);
  assert.equal(compileDirectionalSignal(strategy, inside)(48, 0), 0);
  assert.equal(directionalSignal(strategy, inside, 0).target_exposure, 0);
  const exactAbove = medianFixture(102);
  const exactBelow = medianFixture(98);
  assert.equal(compileDirectionalSignal(strategy, exactAbove)(48, 0), -1);
  assert.equal(compileDirectionalSignal(strategy, exactBelow)(48, 0), 1);
});

test("rolling median reversion excludes execution candle and preserves historical forward parity", () => {
  const strategy = buildStrategyFromResearchSpec("typed-median-reversion-no-lookahead-001", rollingMedianReversionSpec());
  const signalRows = medianFixture(102);
  const execution = { ...signalRows.at(-1), closed_at: new Date(Date.parse(signalRows.at(-1).closed_at) + 3600000).toISOString(), open: 100000, high: 100001, low: 1, close: 2 };
  const rows = [...signalRows, execution];
  assert.equal(compileDirectionalSignal(strategy, rows)(48, 0), -1);
  const mutated = rows.map((row, index) => index === 48 ? { ...row, open: 1, high: 2, low: 0.5, close: 1 } : row);
  assert.equal(compileDirectionalSignal(strategy, mutated)(48, 0), -1);
  assert.equal(directionalSignal(strategy, signalRows, 0).target_exposure, -1);
});

test("rolling median reversion enforces minimum history and sealed next-candle execution", () => {
  const strategy = buildStrategyFromResearchSpec("typed-median-reversion-walk-forward-001", rollingMedianReversionSpec());
  assert.equal(compileDirectionalSignal(strategy, medianFixture(102).slice(0, 47))(47, 1), 1);
  const policy = buildInstitutionalBacktestPolicy();
  const windows = buildWalkForwardWindows(syntheticCandles(), policy);
  const result = runDirectionalWalkForward({ windows, strategies: [strategy], policy });
  assert.equal(result.length, 1);
  assert.equal(result[0].windows.length, 5);
  assert.equal(result[0].windows.every((row) => row.execution_model === "next_completed_candle_open"), true);
  assert.equal(result[0].windows.every((row) => row.evidence_integrity_passed === true), true);
});

function bodyStreakReversalSpec() {
  return typedSpec({ strategy: { template: "body_streak_reversal", feature_set_id: "ohlc-body-streak-reversal-v1", parameters: { streak_length: 4, min_body_fraction: 0.30 } } });
}

function bodyStreakRows(directions, bodyFraction = 0.30) {
  const start = Date.parse("2026-01-01T00:00:00.000Z");
  return directions.map((direction, index) => {
    const low = 95;
    const high = 105;
    const body = 10 * bodyFraction;
    const open = direction > 0 ? 100 : 100 + body;
    const close = direction > 0 ? 100 + body : 100;
    return { closed_at: new Date(start + index * 3600000).toISOString(), open, high, low, close, volume: 100 };
  });
}

test("body streak reversal preregistration is exact and bounded", () => {
  const validated = validateInstitutionalResearchSpec(bodyStreakReversalSpec());
  assert.deepEqual(validated.strategy.parameters, { streak_length: 4, min_body_fraction: 0.30 });
  assert.throws(() => validateInstitutionalResearchSpec(typedSpec({ strategy: { template: "body_streak_reversal", feature_set_id: "ohlc-body-streak-reversal-v1", parameters: { streak_length: 1, min_body_fraction: 0.30 } } })), /streak_length_out_of_bounds/);
  assert.throws(() => validateInstitutionalResearchSpec(typedSpec({ strategy: { template: "body_streak_reversal", feature_set_id: "ohlc-body-streak-reversal-v1", parameters: { streak_length: 4, min_body_fraction: 0.99 } } })), /min_body_fraction_out_of_bounds/);
});

test("body streak reversal has symmetric exhaustion signals and exact threshold inclusion", () => {
  const strategy = buildStrategyFromResearchSpec("typed-body-streak-001", bodyStreakReversalSpec());
  const bullish = bodyStreakRows([1, 1, 1, 1]);
  const bearish = bodyStreakRows([-1, -1, -1, -1]);
  assert.equal(compileDirectionalSignal(strategy, bullish)(4, 0), -1);
  assert.equal(directionalSignal(strategy, bullish, 0).target_exposure, -1);
  assert.equal(compileDirectionalSignal(strategy, bearish)(4, 0), 1);
  assert.equal(directionalSignal(strategy, bearish, 0).target_exposure, 1);
});

test("body streak reversal fails flat on mixed, weak, zero-range, and insufficient history", () => {
  const strategy = buildStrategyFromResearchSpec("typed-body-streak-flat-001", bodyStreakReversalSpec());
  const mixed = bodyStreakRows([1, 1, -1, 1]);
  const weak = bodyStreakRows([1, 1, 1, 1], 0.29);
  const zeroRange = bodyStreakRows([1, 1, 1, 1]).map((row, index) => index === 2 ? { ...row, open: 100, high: 100, low: 100, close: 100 } : row);
  for (const rows of [mixed, weak, zeroRange]) {
    assert.equal(compileDirectionalSignal(strategy, rows)(4, 0), 0);
    assert.equal(directionalSignal(strategy, rows, 0).target_exposure, 0);
  }
  assert.equal(compileDirectionalSignal(strategy, bodyStreakRows([1, 1, 1]))(3, 1), 1);
});

test("body streak reversal excludes execution candle and preserves historical forward parity", () => {
  const strategy = buildStrategyFromResearchSpec("typed-body-streak-no-lookahead-001", bodyStreakReversalSpec());
  const signalRows = bodyStreakRows([1, 1, 1, 1]);
  const execution = { ...signalRows.at(-1), closed_at: new Date(Date.parse(signalRows.at(-1).closed_at) + 3600000).toISOString(), open: 1, high: 100000, low: 0.01, close: 1 };
  const rows = [...signalRows, execution];
  assert.equal(compileDirectionalSignal(strategy, rows)(4, 0), -1);
  const mutated = rows.map((row, index) => index === 4 ? { ...row, open: 100000, high: 100001, low: 1, close: 2 } : row);
  assert.equal(compileDirectionalSignal(strategy, mutated)(4, 0), -1);
  assert.equal(directionalSignal(strategy, signalRows, 0).target_exposure, -1);
});

test("body streak reversal executes through sealed next-completed-candle walk-forward math", () => {
  const policy = buildInstitutionalBacktestPolicy();
  const windows = buildWalkForwardWindows(syntheticCandles(), policy);
  const strategy = buildStrategyFromResearchSpec("typed-body-streak-walk-forward-001", bodyStreakReversalSpec());
  const result = runDirectionalWalkForward({ windows, strategies: [strategy], policy });
  assert.equal(result.length, 1);
  assert.equal(result[0].windows.length, 5);
  assert.equal(result[0].windows.every((row) => row.execution_model === "next_completed_candle_open"), true);
  assert.equal(result[0].windows.every((row) => row.evidence_integrity_passed === true), true);
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

function returnSemivarianceImbalanceSpec() {
  return typedSpec({ strategy: { template: "return_semivariance_imbalance", feature_set_id: "close-return-semivariance-imbalance-v1", parameters: { period: 72, imbalance_threshold: 0.65 } } });
}

function semivarianceRows(signs) {
  const start = Date.parse("2026-01-01T00:00:00.000Z");
  let close = 100;
  const rows = [{ closed_at: new Date(start).toISOString(), open: close, high: close + 1, low: close - 1, close, volume: 100 }];
  signs.forEach((sign, index) => {
    const next = close * (sign > 0 ? 1.01 : sign < 0 ? 0.99 : 1);
    rows.push({ closed_at: new Date(start + (index + 1) * 3600000).toISOString(), open: close, high: Math.max(close, next) + 1, low: Math.min(close, next) - 1, close: next, volume: 100 });
    close = next;
  });
  return rows;
}

test("return semivariance imbalance preregistration is frozen and bounded", () => {
  const validated = validateInstitutionalResearchSpec(returnSemivarianceImbalanceSpec());
  assert.deepEqual(validated.strategy.parameters, { period: 72, imbalance_threshold: 0.65 });
  assert.throws(() => validateInstitutionalResearchSpec(typedSpec({ strategy: { template: "return_semivariance_imbalance", feature_set_id: "close-return-semivariance-imbalance-v1", parameters: { period: 72, imbalance_threshold: 0.5 } } })), /imbalance_threshold_out_of_bounds/);
});

test("return semivariance imbalance has symmetric energy signals and historical-forward parity", () => {
  const strategy = buildStrategyFromResearchSpec("typed-return-semivariance-001", returnSemivarianceImbalanceSpec());
  const upside = semivarianceRows([...Array(60).fill(1), ...Array(12).fill(-1)]);
  const downside = semivarianceRows([...Array(12).fill(1), ...Array(60).fill(-1)]);
  const balanced = semivarianceRows([...Array(36).fill(1), ...Array(36).fill(-1)]);
  for (const [rows, expected] of [[upside, 1], [downside, -1], [balanced, 0]]) {
    assert.equal(compileDirectionalSignal(strategy, rows)(rows.length, 0), expected);
    assert.equal(directionalSignal(strategy, rows, 0).target_exposure, expected);
  }
});

test("return semivariance imbalance excludes execution candle, handles zero energy, and seals walk-forward", () => {
  const strategy = buildStrategyFromResearchSpec("typed-return-semivariance-no-lookahead-001", returnSemivarianceImbalanceSpec());
  const signalRows = semivarianceRows([...Array(60).fill(1), ...Array(12).fill(-1)]);
  const execution = { ...signalRows.at(-1), closed_at: new Date(Date.parse(signalRows.at(-1).closed_at) + 3600000).toISOString(), open: 1, high: 100000, low: 0.01, close: 1 };
  const rows = [...signalRows, execution];
  const baseline = compileDirectionalSignal(strategy, rows)(signalRows.length, 0);
  assert.equal(baseline, 1);
  const mutated = rows.map((row, index) => index === signalRows.length ? { ...row, open: 100000, high: 100001, low: 1, close: 2 } : row);
  assert.equal(compileDirectionalSignal(strategy, mutated)(signalRows.length, 0), baseline);
  const flat = semivarianceRows(Array(72).fill(0));
  assert.equal(compileDirectionalSignal(strategy, flat)(flat.length, 1), 0);
  assert.equal(directionalSignal(strategy, flat, 1).target_exposure, 0);
  const policy = buildInstitutionalBacktestPolicy();
  const windows = buildWalkForwardWindows(syntheticCandles(), policy);
  const result = runDirectionalWalkForward({ windows, strategies: [strategy], policy });
  assert.equal(result[0].windows.length, 5);
  assert.equal(result[0].windows.every((row) => row.execution_model === "next_completed_candle_open" && row.evidence_integrity_passed === true), true);
});

function returnSignTransitionStateSpec() {
  return typedSpec({ strategy: { template: "return_sign_transition_state", feature_set_id: "close-return-sign-transition-v1", parameters: { period: 48, persistence_threshold: 0.60 } } });
}

test("return sign transition state preregistration is frozen and bounded", () => {
  const validated = validateInstitutionalResearchSpec(returnSignTransitionStateSpec());
  assert.deepEqual(validated.strategy.parameters, { period: 48, persistence_threshold: 0.60 });
  assert.throws(() => validateInstitutionalResearchSpec(typedSpec({ strategy: { template: "return_sign_transition_state", feature_set_id: "close-return-sign-transition-v1", parameters: { period: 48, persistence_threshold: 0.5 } } })), /persistence_threshold_out_of_bounds/);
});

test("return sign transition state is no-look-ahead and sealed-walk-forward compatible", () => {
  const rows = syntheticCandles(180);
  const strategy = buildStrategyFromResearchSpec("typed-return-sign-transition-001", returnSignTransitionStateSpec());
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

test("return sign transition state distinguishes persistence from alternation and ignores zero returns", () => {
  const start = Date.parse("2026-01-01T00:00:00.000Z");
  const buildRows = (signs) => {
    let close = 100;
    const rows = [{ closed_at: new Date(start).toISOString(), open: close, high: close, low: close, close, volume: 100 }];
    signs.forEach((sign, index) => {
      const next = sign === 0 ? close : close * (sign > 0 ? 1.01 : 0.99);
      rows.push({ closed_at: new Date(start + (index + 1) * 3600000).toISOString(), open: close, high: Math.max(close, next), low: Math.min(close, next), close: next, volume: 100 });
      close = next;
    });
    return rows;
  };
  const strategy = buildStrategyFromResearchSpec("typed-return-sign-transition-paths-001", returnSignTransitionStateSpec());
  const persistent = buildRows(Array(48).fill(1));
  const alternating = buildRows(Array.from({ length: 48 }, (_, index) => index % 2 === 0 ? 1 : -1));
  const withZeros = buildRows(Array.from({ length: 48 }, (_, index) => index % 5 === 0 ? 0 : 1));
  assert.equal(compileDirectionalSignal(strategy, persistent)(persistent.length, 0), 1);
  assert.equal(compileDirectionalSignal(strategy, alternating)(alternating.length, 0), 1);
  assert.equal(compileDirectionalSignal(strategy, withZeros)(withZeros.length, 0), 1);
});

function returnSkewStateSpec() {
  return typedSpec({ strategy: { template: "return_skew_state", feature_set_id: "close-return-skew-v1", parameters: { period: 72, skew_threshold: 0.50 } } });
}

test("return skew state preregistration is frozen and bounded", () => {
  const validated = validateInstitutionalResearchSpec(returnSkewStateSpec());
  assert.deepEqual(validated.strategy.parameters, { period: 72, skew_threshold: 0.50 });
  assert.throws(() => validateInstitutionalResearchSpec(typedSpec({ strategy: { template: "return_skew_state", feature_set_id: "close-return-skew-v1", parameters: { period: 72, skew_threshold: 0 } } })), /skew_threshold_out_of_bounds/);
});

test("return skew state is no-look-ahead, zero-variance safe, and sealed-walk-forward compatible", () => {
  const rows = syntheticCandles(180);
  const strategy = buildStrategyFromResearchSpec("typed-return-skew-001", returnSkewStateSpec());
  const executionIndex = 150;
  const baseline = compileDirectionalSignal(strategy, rows)(executionIndex, 0);
  const mutated = rows.map((row, index) => index === executionIndex ? { ...row, close: row.close * 25 } : row);
  assert.equal(compileDirectionalSignal(strategy, mutated)(executionIndex, 0), baseline);
  const flatRows = Array.from({ length: 80 }, (_, index) => ({ closed_at: new Date(Date.parse("2026-01-01T00:00:00.000Z") + index * 3600000).toISOString(), open: 100, high: 100, low: 100, close: 100, volume: 100 }));
  assert.equal(compileDirectionalSignal(strategy, flatRows)(flatRows.length, 1), 0);
  const policy = buildInstitutionalBacktestPolicy();
  const windows = buildWalkForwardWindows(syntheticCandles(), policy);
  const result = runDirectionalWalkForward({ windows, strategies: [strategy], policy });
  assert.equal(result[0].windows.length, 5);
  assert.equal(result[0].windows.every((row) => row.evidence_integrity_passed === true), true);
});

function hourOfWeekDriftSpec() {
  return typedSpec({ strategy: { template: "hour_of_week_drift", feature_set_id: "time-hour-of-week-drift-v1", parameters: { lookback_weeks: 12, mean_return_threshold_bps: 5 } } });
}

test("hour-of-week drift preregistration is frozen and bounded", () => {
  const validated = validateInstitutionalResearchSpec(hourOfWeekDriftSpec());
  assert.deepEqual(validated.strategy.parameters, { lookback_weeks: 12, mean_return_threshold_bps: 5 });
  assert.throws(() => validateInstitutionalResearchSpec(typedSpec({ strategy: { template: "hour_of_week_drift", feature_set_id: "time-hour-of-week-drift-v1", parameters: { lookback_weeks: 3, mean_return_threshold_bps: 5 } } })), /lookback_weeks_out_of_bounds/);
});

test("hour-of-week drift is no-look-ahead, exact-week indexed in both signal paths, and sealed-walk-forward compatible", async () => {
  const rows = syntheticCandles(2400);
  const strategy = buildStrategyFromResearchSpec("typed-hour-week-drift-001", hourOfWeekDriftSpec());
  const executionIndex = 2200;
  const baseline = compileDirectionalSignal(strategy, rows)(executionIndex, 0);
  const mutated = rows.map((row, index) => index === executionIndex ? { ...row, close: row.close * 25 } : row);
  assert.equal(compileDirectionalSignal(strategy, mutated)(executionIndex, 0), baseline);
  const historicalSource = await readFile(new URL("../src/directionalBacktest.js", import.meta.url), "utf8");
  const forwardSource = await readFile(new URL("../src/directionalShadow.js", import.meta.url), "utf8");
  for (const source of [historicalSource, forwardSource]) {
    assert.match(source, /const hoursPerWeek = 7 \* 24/);
    assert.match(source, /signalIndex - week \* hoursPerWeek/);
    assert.match(source, /hour_of_week_contiguous_slot_alignment_invalid/);
  }
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

function linearTrendResidualSpec() {
  return typedSpec({
    strategy: {
      template: "linear_trend_residual_reversion",
      feature_set_id: "close-linear-trend-residual-v1",
      parameters: { period: 48, threshold_percent: 2 },
    },
  });
}

function linearTrendResidualRows(lastClose = 100) {
  const start = Date.parse("2026-01-01T00:00:00.000Z");
  return Array.from({ length: 49 }, (_, index) => ({
    closed_at: new Date(start + index * 3600000).toISOString(),
    open: index === 47 ? lastClose : 100,
    high: Math.max(100, index === 47 ? lastClose : 100) + 1,
    low: Math.min(100, index === 47 ? lastClose : 100) - 1,
    close: index === 47 ? lastClose : index === 48 ? 100 : 100,
    volume: 100,
  }));
}

test("linear trend residual reversion is bounded and historical-forward paths agree", () => {
  const spec = linearTrendResidualSpec();
  const validated = validateInstitutionalResearchSpec(spec);
  assert.deepEqual(validated.strategy.parameters, { period: 48, threshold_percent: 2 });
  const strategy = buildStrategyFromResearchSpec("typed-linear-trend-residual-001", spec);
  const above = linearTrendResidualRows(106);
  const below = linearTrendResidualRows(94);
  const flat = linearTrendResidualRows(101);
  assert.equal(directionalSignal(strategy, above.slice(0, 48), 0).target_exposure, -1);
  assert.equal(directionalSignal(strategy, below.slice(0, 48), 0).target_exposure, 1);
  assert.equal(directionalSignal(strategy, flat.slice(0, 48), 0).target_exposure, 0);
  assert.equal(compileDirectionalSignal(strategy, above)(48, 0), -1);
  assert.equal(compileDirectionalSignal(strategy, below)(48, 0), 1);
  assert.equal(compileDirectionalSignal(strategy, flat)(48, 0), 0);
  const baseline = compileDirectionalSignal(strategy, above)(48, 0);
  const mutatedExecution = above.map((row, index) => index === 48 ? { ...row, open: 5000, high: 6000, low: 4000, close: 5500 } : row);
  assert.equal(compileDirectionalSignal(strategy, mutatedExecution)(48, 0), baseline);
  assert.throws(() => validateInstitutionalResearchSpec(typedSpec({ strategy: { template: "linear_trend_residual_reversion", feature_set_id: "close-linear-trend-residual-v1", parameters: { period: 8, threshold_percent: 2 } } })), /period_out_of_bounds/);
});

function volatilityShockReversalSpec() {
  return typedSpec({
    strategy: {
      template: "volatility_shock_reversal",
      feature_set_id: "ohlc-true-range-shock-reversal-v1",
      parameters: { period: 24, multiplier: 2 },
    },
  });
}

function volatilityShockRows({ direction = "bullish", ratio = 2, zeroBody = false } = {}) {
  const start = Date.parse("2026-01-01T00:00:00.000Z");
  const rows = [];
  for (let index = 0; index < 26; index += 1) {
    const open = 100;
    if (index === 25) {
      const halfRange = ratio;
      rows.push({
        closed_at: new Date(start + index * 3600000).toISOString(),
        open,
        high: 100 + halfRange,
        low: 100 - halfRange,
        close: zeroBody ? 100 : direction === "bullish" ? 101 : 99,
        volume: 100,
      });
    } else {
      rows.push({ closed_at: new Date(start + index * 3600000).toISOString(), open, high: 101, low: 99, close: 100, volume: 100 });
    }
  }
  return rows;
}

test("volatility shock reversal preregistration is exact and bounded", () => {
  const validated = validateInstitutionalResearchSpec(volatilityShockReversalSpec());
  assert.deepEqual(validated.strategy.parameters, { period: 24, multiplier: 2 });
  assert.throws(() => validateInstitutionalResearchSpec(typedSpec({ strategy: { template: "volatility_shock_reversal", feature_set_id: "ohlc-true-range-shock-reversal-v1", parameters: { period: 8, multiplier: 2 } } })), /period_out_of_bounds/);
  assert.throws(() => validateInstitutionalResearchSpec(typedSpec({ strategy: { template: "volatility_shock_reversal", feature_set_id: "ohlc-true-range-shock-reversal-v1", parameters: { period: 24, multiplier: 1 } } })), /multiplier_out_of_bounds/);
});

test("volatility shock reversal fades bullish and bearish exact-boundary shocks and keeps zero-body flat", () => {
  const strategy = buildStrategyFromResearchSpec("typed-volatility-shock-001", volatilityShockReversalSpec());
  const bullish = volatilityShockRows({ direction: "bullish", ratio: 2 });
  const bearish = volatilityShockRows({ direction: "bearish", ratio: 2 });
  const zeroBody = volatilityShockRows({ zeroBody: true, ratio: 2 });
  assert.equal(directionalSignal(strategy, bullish.slice(0, 26), 0).target_exposure, -1);
  assert.equal(directionalSignal(strategy, bearish.slice(0, 26), 0).target_exposure, 1);
  assert.equal(directionalSignal(strategy, zeroBody.slice(0, 26), 0).target_exposure, 0);
  assert.equal(compileDirectionalSignal(strategy, bullish)(26, 0), -1);
  assert.equal(compileDirectionalSignal(strategy, bearish)(26, 0), 1);
});

test("volatility shock reversal stays flat below threshold and excludes execution candle", () => {
  const strategy = buildStrategyFromResearchSpec("typed-volatility-shock-no-lookahead-001", volatilityShockReversalSpec());
  const below = volatilityShockRows({ direction: "bullish", ratio: 1.5 });
  assert.equal(compileDirectionalSignal(strategy, below)(26, 0), 0);
  const rows = [...volatilityShockRows({ direction: "bullish", ratio: 2 }), { closed_at: "2026-01-02T02:00:00.000Z", open: 1000, high: 5000, low: 1, close: 2, volume: 100 }];
  const baseline = compileDirectionalSignal(strategy, rows)(26, 0);
  const mutated = rows.map((row, index) => index === 26 ? { ...row, open: 50, high: 60, low: 40, close: 55 } : row);
  assert.equal(compileDirectionalSignal(strategy, mutated)(26, 0), baseline);
  const policy = buildInstitutionalBacktestPolicy();
  const windows = buildWalkForwardWindows(syntheticCandles(), policy);
  const result = runDirectionalWalkForward({ windows, strategies: [strategy], policy });
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

test("Stage 14 forward evidence resumes prospectively after an operational gap without backfilling missed cycles", () => {
  assert.equal(institutionalForwardElapsedHours("2026-08-20T01:00:00.000Z", "2026-08-20T02:00:00.000Z"), 1);
  assert.equal(institutionalForwardElapsedHours("2026-08-20T01:00:00.000Z", "2026-08-24T18:00:00.000Z"), 113);
  assert.throws(() => institutionalForwardElapsedHours("2026-08-20T02:00:00.000Z", "2026-08-20T02:00:00.000Z"), /institutional_forward_elapsed_hours_invalid/);
  assert.throws(() => institutionalForwardElapsedHours("2026-08-20T01:30:00.000Z", "2026-08-20T02:00:00.000Z"), /institutional_forward_elapsed_hours_invalid/);
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
